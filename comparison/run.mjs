// Pinned multi-tool comparison for the browser-served lane.
//
//   npm ci --prefix comparison
//   node comparison/run.mjs --fixture-root <corpus checkout at pins.corpus.revision> \
//        --out <directory> [--suite latest-browser-served|all] [--tools axe,ibm,...] \
//        [--chromium <executable>] [--cognium-export <file>] [--allow-unpinned]
//
//   node comparison/run.mjs --lane latest-browser-served-explore-2 | latest-browser-served-journey-pages \
//        --fixture-root <corpus> --out <directory> --tools cognium --cognium-export <file>
//
// `--lane` names a VARIANT of the published lane (lanes.mjs). A variant is
// Cognium-only, writes <out>/<variant>/comparison.json with a `lane` block, is
// published apart under its own bundle name and is never quoted as the
// latest-browser-served lane. Without `--lane` the run and its output are what
// they were before variants existed.
//
// It writes <out>/comparison.json in the shape the published results repository
// imports (`scripts/import-comparison.mjs` there), and prints the lane metrics.
//
// What is pinned, and where:
//   - the corpus: `pins.json` names the revision and manifest digest; the run
//     refuses a checkout that differs or has local changes;
//   - every tool and its whole dependency tree: `package.json` (exact versions)
//     and `package-lock.json`; the run refuses an install that differs;
//   - the IBM rule engine, which accessibility-checker otherwise downloads at
//     run time: both the archive list and the engine are packages in the lock
//     and are served to the checker on 127.0.0.1;
//   - the case list: `suites/<name>.json`.
//
// What is not pinned by this directory, and is recorded instead:
//   - the browser build (`--chromium`, else Playwright's own build for 1.61.1);
//   - the operating system, CPU architecture and installed fonts;
//   - the Nu Html Checker service, which is a container image named in pins.json;
//   - Cognium Conformis, whose runtime is private: its sanitized export is
//     imported with `import-cognium.mjs` and passed with `--cognium-export`.
//
// Scoring is the published lane's: a known defect is detected when a finding
// maps to one of its declared `min_criteria`; a corrected control is
// target-clean when no finding maps to one of its `must_not_report` criteria.
// Findings on other criteria are kept and earn nothing. No finding is never a
// pass. See check/comparable-lane.mjs and SCORING.md.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

import qualwebActRules from '@qualweb/act-rules';
import qualwebBestPractices from '@qualweb/best-practices';
import qualwebCore from '@qualweb/core';
import qualwebWcagTechniques from '@qualweb/wcag-techniques';
import { Audit as AlfaAudit, Outcome as AlfaOutcome } from '@siteimprove/alfa-act';
import { Puppeteer as AlfaPuppeteer } from '@siteimprove/alfa-puppeteer';
import alfaRules from '@siteimprove/alfa-rules';
import * as ibmChecker from 'accessibility-checker';
import axeCore from 'axe-core';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import pa11y from 'pa11y';
import { chromium } from 'playwright';
import puppeteer from 'puppeteer';

import { DEFAULT_LANE, laneByName, snapshotFile } from './lanes.mjs';
import { NAVIGATION_TIMEOUT_MS, navigateWithRetry } from './navigate.mjs';
import {
  buildSnapshot, cogniumRows, expectedCriteria, rowFor, summarize, toolEntry,
} from './snapshot.mjs';

export { summarize };

const { ACTRules } = qualwebActRules;
const { BestPractices } = qualwebBestPractices;
const { QualWeb } = qualwebCore;
const { WCAGTechniques } = qualwebWcagTechniques;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const PINS = JSON.parse(fs.readFileSync(path.join(HERE, 'pins.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const VIEWPORT = PINS.viewport;

const ALL_TOOL_IDS = ['cognium', 'axe', 'pa11y-htmlcs', 'ibm', 'lighthouse', 'alfa', 'qualweb', 'nu-html-checker'];
const DIRECT_TOOL_IDS = ['axe', 'pa11y-htmlcs', 'ibm', 'lighthouse', 'alfa', 'qualweb'];
const TOOL_LABELS = {
  cognium: 'Cognium Conformis',
  axe: 'axe-core',
  'pa11y-htmlcs': 'Pa11y / HTML_CodeSniffer',
  ibm: 'IBM Equal Access',
  lighthouse: 'Lighthouse accessibility',
  alfa: 'Siteimprove Alfa',
  qualweb: 'QualWeb',
  'nu-html-checker': 'Nu Html Checker',
};
const CRITERION_MAPPED = 'criterion-mapped automated detection';
const TOOL_LINEAGE = {
  cognium: {
    name: 'Cognium Conformis',
    engine_family: 'Conformis a11y/html and tech/html-aria',
    tool_surface: 'site scan with subject-declared entry pages',
    independence: 'independent-engine',
    metric_family: CRITERION_MAPPED,
  },
  axe: {
    name: 'axe-core', engine_family: 'axe-core', tool_surface: 'Playwright page injection',
    independence: 'independent-engine', metric_family: CRITERION_MAPPED,
  },
  'pa11y-htmlcs': {
    name: 'Pa11y / HTML_CodeSniffer', engine_family: 'HTML_CodeSniffer', tool_surface: 'Pa11y runner',
    independence: 'wrapper', wrapper_of: 'HTML_CodeSniffer', metric_family: CRITERION_MAPPED,
  },
  ibm: {
    name: 'IBM Equal Access', engine_family: 'IBM Equal Access Accessibility Checker',
    tool_surface: 'Playwright page API', independence: 'independent-engine', metric_family: CRITERION_MAPPED,
  },
  lighthouse: {
    name: 'Lighthouse accessibility', engine_family: 'axe-core-derived Lighthouse audits',
    tool_surface: 'Lighthouse accessibility category', independence: 'derived-configuration',
    wrapper_of: 'axe-core', metric_family: CRITERION_MAPPED,
  },
  alfa: {
    name: 'Siteimprove Alfa', engine_family: 'Alfa ACT rules', tool_surface: 'Puppeteer page API',
    independence: 'independent-engine', metric_family: CRITERION_MAPPED,
  },
  qualweb: {
    name: 'QualWeb', engine_family: 'QualWeb ACT rules, WCAG techniques and best practices',
    tool_surface: 'QualWeb Core local browser evaluation', independence: 'independent-engine',
    metric_family: CRITERION_MAPPED,
  },
  'nu-html-checker': {
    name: 'Nu Html Checker', engine_family: 'v.Nu HTML, CSS and SVG conformance checker',
    tool_surface: 'local validator service', independence: 'independent-engine',
    metric_family: 'specialized markup signal',
  },
};
const CHROME_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function packageJson(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'));
}

function packageVersion(name) {
  return packageJson(name).version;
}

function sha256Json(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function sha256File(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// ------------------------------------------------------------------ mappings

function criteriaFromAxeTags(tags = []) {
  return [...new Set(tags.flatMap((tag) => {
    const match = /^wcag(\d{3,4})$/.exec(tag);
    if (!match) return [];
    const digits = match[1];
    return digits.length === 3
      ? [`${digits[0]}.${digits[1]}.${digits[2]}`]
      : [`${digits[0]}.${digits[1]}.${digits.slice(2)}`];
  }))].sort();
}

function criteriaFromPa11yCode(code = '') {
  const match = /Guideline\d+_\d+\.(\d+)_(\d+)_(\d+)/.exec(code);
  return match ? [`${match[1]}.${match[2]}.${match[3]}`] : [];
}

function criteriaFromAlfaRule(rule) {
  return [...new Set(rule.requirements.flatMap((requirement) => {
    const metadata = requirement.toJSON();
    return metadata.type === 'criterion' && /^\d+\.\d+\.\d+$/.test(metadata.chapter)
      ? [metadata.chapter]
      : [];
  }))].sort();
}

function criteriaFromQualWebAssertion(assertion) {
  return [...new Set((assertion.metadata?.['success-criteria'] || []).flatMap((criterion) => {
    const match = /\b\d+\.\d+\.\d+\b/.exec(String(criterion.name || ''));
    return match ? [match[0]] : [];
  }))].sort();
}

function aggregateFindings(items, rule, count, criteria) {
  const grouped = new Map();
  for (const item of items) {
    const id = rule(item);
    const current = grouped.get(id) || { rule: id, count: 0, criteria: new Set() };
    current.count += count(item);
    for (const criterion of criteria(item)) current.criteria.add(criterion);
    grouped.set(id, current);
  }
  return [...grouped.values()]
    .map((item) => ({ ...item, criteria: [...item.criteria].sort() }))
    .sort((a, b) => a.rule.localeCompare(b.rule));
}

let FIXTURE_ROOT = '';

function errorRow(testCase, started, error) {
  const message = String(error?.message || error)
    .replaceAll(FIXTURE_ROOT, '<fixture>')
    .replaceAll(REPO_ROOT, '<benchmark>')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '<local-home>')
    .split('\n')[0];
  return {
    id: testCase.id,
    mode: testCase.mode,
    path: testCase.path,
    expected_criteria: expectedCriteria(testCase),
    status: 'error',
    automated_findings: 0,
    manual_review_items: 0,
    found_criteria: [],
    matched_expected_criteria: [],
    findings: [],
    duration_ms: Date.now() - started,
    error: message,
  };
}

// ------------------------------------------------------------------ adapters

let COGNIUM_EXPORT = null;

function runCognium(cases) {
  assert.ok(COGNIUM_EXPORT, 'cognium needs --cognium-export <file> written by import-cognium.mjs');
  const exported = JSON.parse(fs.readFileSync(COGNIUM_EXPORT, 'utf8'));
  return cogniumRows(exported, cases, { suiteName: SUITE_NAME, corpusRevision: CORPUS_REVISION, laneName: LANE_NAME });
}

async function loadPage(page, url, testCase) {
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  if (!response || response.status() !== 200) throw new Error(`HTTP ${response?.status() ?? 'none'}`);
  await page.waitForTimeout(testCase.id === 'delivery-client_js_delayed' ? 1000 : 150);
}

async function loadPuppeteerPage(page, url, testCase) {
  const response = await navigateWithRetry(() => page.goto(url, { waitUntil: 'networkidle0', timeout: NAVIGATION_TIMEOUT_MS }));
  if (!response || response.status() !== 200) throw new Error(`HTTP ${response?.status() ?? 'none'}`);
  await new Promise((resolve) => setTimeout(resolve,
    testCase.id === 'delivery-client_js_delayed' ? 1000 : 150));
}

async function runAxe(cases, baseUrl, executablePath) {
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const rows = [];
  for (const testCase of cases) {
    const started = Date.now();
    const page = await context.newPage();
    try {
      await loadPage(page, `${baseUrl}/${testCase.path}`, testCase);
      await page.addScriptTag({ content: axeCore.source });
      const result = await page.evaluate(async (tags) => window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations', 'incomplete'],
      }), AXE_TAGS);
      const findings = result.violations.map((violation) => ({
        rule: violation.id,
        count: violation.nodes.length,
        criteria: criteriaFromAxeTags(violation.tags),
      })).sort((a, b) => a.rule.localeCompare(b.rule));
      const manual = result.incomplete.reduce((sum, item) => sum + item.nodes.length, 0);
      rows.push(rowFor(testCase, started, findings, manual, { source_output_sha256: sha256Json(result) }));
    } catch (error) {
      rows.push(errorRow(testCase, started, error));
    } finally {
      await page.close();
    }
    process.stderr.write(`axe ${testCase.id}\n`);
  }
  await context.close();
  await browser.close();
  return rows;
}

async function runPa11y(cases, baseUrl, executablePath) {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: CHROME_ARGS });
  const rows = [];
  try {
    for (const testCase of cases) {
      const started = Date.now();
      try {
        const result = await pa11y(`${baseUrl}/${testCase.path}`, {
          browser,
          runners: ['htmlcs'],
          standard: 'WCAG2AA',
          includeWarnings: true,
          includeNotices: false,
          timeout: 30000,
          wait: testCase.id === 'delivery-client_js_delayed' ? 1000 : 150,
          viewport: VIEWPORT,
        });
        const automatic = result.issues.filter((issue) => issue.type === 'error');
        const findings = aggregateFindings(automatic, (issue) => issue.code, () => 1,
          (issue) => criteriaFromPa11yCode(issue.code));
        const manual = result.issues.filter((issue) => issue.type !== 'error').length;
        rows.push(rowFor(testCase, started, findings, manual, { source_output_sha256: sha256Json(result) }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      }
      process.stderr.write(`pa11y-htmlcs ${testCase.id}\n`);
    }
  } finally {
    await browser.close();
  }
  return rows;
}

// accessibility-checker fetches `<ruleServer>/archives.json`, picks the archive
// for ruleArchive `versioned`, then fetches `<ruleServer><archive path>/js/ace.js`.
// This serves exactly the pinned list and the pinned engine, and nothing else.
async function startIbmRuleServer() {
  const listFile = path.join(HERE, 'node_modules', 'ibm-rule-archive-list', 'archives.json');
  const archives = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const checkerVersion = packageVersion('accessibility-checker');
  const engineVersion = packageVersion('accessibility-checker-engine');
  const compare = (a, b) => {
    const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  // the checker's own `versioned` rule (ACConfigManager.findLatestArchiveId)
  const selected = archives.find((archive) => !['latest', 'preview', 'versioned'].includes(archive.id)
    && compare(checkerVersion, archive.version) >= 0);
  assert.ok(selected, 'no IBM rule archive for the pinned checker version');
  const pinned = PINS.tools.ibm.rule_archive;
  assert.equal(selected.id, pinned.id, `IBM archive list resolves ${selected.id}, pinned ${pinned.id}`);
  assert.equal(selected.version, engineVersion, `IBM archive ${selected.id} needs engine ${selected.version}, installed ${engineVersion}`);
  const engineDir = path.join(HERE, 'node_modules', 'accessibility-checker-engine');
  const prefix = `${selected.path}/js/`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = null;
    if (url.pathname === '/archives.json') file = listFile;
    else if (url.pathname.startsWith(prefix)) {
      const rel = url.pathname.slice(prefix.length);
      if (/^[A-Za-z0-9._-]+$/.test(rel)) file = path.join(engineDir, rel);
    }
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not pinned');
      return;
    }
    res.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/javascript' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    engine: {
      checker: checkerVersion,
      engine: engineVersion,
      archive_id: selected.id,
      archive_name: selected.name,
      archive_list: `accessibility-checker-engine@${packageVersion('ibm-rule-archive-list')} archives.json (${sha256File(listFile)})`,
      ace_js_sha256: sha256File(path.join(engineDir, 'ace.js')),
    },
  };
}

function ibmCriteriaMap(rulesets) {
  const map = new Map();
  for (const ruleset of rulesets || []) {
    for (const checkpoint of ruleset.checkpoints || []) {
      const criterion = /\b\d+\.\d+\.\d+\b/.exec(String(checkpoint.num || checkpoint.id || ''))?.[0];
      for (const rule of checkpoint.rules || []) {
        const values = map.get(rule.id) || new Set();
        if (criterion) values.add(criterion);
        map.set(rule.id, values);
      }
    }
  }
  return new Map([...map].map(([key, values]) => [key, [...values].sort()]));
}

let IBM_ENGINE = null;

async function runIbm(cases, baseUrl, executablePath) {
  const ruleServer = await startIbmRuleServer();
  IBM_ENGINE = ruleServer.engine;
  const cacheFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-benchmark-ibm-'));
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const rows = [];
  try {
    await ibmChecker.setConfig({
      ruleArchive: 'versioned',
      ruleServer: ruleServer.url,
      policies: ['WCAG_2_2'],
      failLevels: ['violation'],
      reportLevels: ['violation', 'potentialviolation', 'manual', 'pass'],
      outputFormat: ['disable'],
      outputFilenameTimestamp: false,
      label: ['IBMa-Node-TeSt'],
      cacheFolder,
      outputFolder: path.join(cacheFolder, 'results'),
      baselineFolder: path.join(cacheFolder, 'baselines'),
    });
    const criteriaMap = ibmCriteriaMap(await ibmChecker.getRulesets());
    for (const testCase of cases) {
      const started = Date.now();
      const page = await context.newPage();
      try {
        await loadPage(page, `${baseUrl}/${testCase.path}`, testCase);
        const result = await ibmChecker.getCompliance(page, testCase.id);
        if (!result?.report?.results) throw new Error('IBM checker returned no result list');
        const automatic = result.report.results.filter((item) =>
          item.value?.[0] === 'VIOLATION' && item.value?.[1] === 'FAIL');
        const findings = aggregateFindings(automatic, (item) => item.ruleId, () => 1,
          (item) => criteriaMap.get(item.ruleId) || []);
        const manual = result.report.results.filter((item) =>
          item.value?.[0] === 'VIOLATION' && ['POTENTIAL', 'MANUAL'].includes(item.value?.[1])).length;
        rows.push(rowFor(testCase, started, findings, manual, {
          rule_archive: result.report.summary?.ruleArchive || null,
          source_output_sha256: sha256Json(result),
        }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      } finally {
        await page.close();
      }
      process.stderr.write(`ibm ${testCase.id}\n`);
    }
  } finally {
    await context.close();
    await browser.close();
    await ibmChecker.close();
    ruleServer.server.close();
    fs.rmSync(cacheFolder, { recursive: true, force: true });
  }
  return rows;
}

async function runLighthouse(cases, baseUrl, executablePath) {
  const chrome = await chromeLauncher.launch({ chromePath: executablePath, chromeFlags: CHROME_ARGS, logLevel: 'silent' });
  const axeRules = new Map(axeCore.getRules(AXE_TAGS).map((rule) => [rule.ruleId, criteriaFromAxeTags(rule.tags)]));
  const rows = [];
  try {
    for (const testCase of cases) {
      const started = Date.now();
      try {
        const result = await lighthouse(`${baseUrl}/${testCase.path}`, {
          port: chrome.port,
          onlyCategories: ['accessibility'],
          output: 'json',
          logLevel: 'silent',
          disableStorageReset: true,
          enableErrorReporting: false,
          maxWaitForLoad: 30000,
        });
        if (!result?.lhr?.audits) throw new Error('Lighthouse returned no audits');
        if (result.lhr.runtimeError) throw new Error(`Lighthouse runtime error: ${result.lhr.runtimeError.code}`);
        const failed = Object.values(result.lhr.audits).filter((audit) =>
          audit.scoreDisplayMode === 'binary' && audit.score === 0);
        const findings = failed.map((audit) => ({
          rule: audit.id,
          count: Math.max(1, audit.details?.items?.length || 0),
          criteria: axeRules.get(audit.id) || [],
        })).sort((a, b) => a.rule.localeCompare(b.rule));
        const manual = Object.values(result.lhr.audits).filter((audit) => audit.scoreDisplayMode === 'manual').length;
        rows.push(rowFor(testCase, started, findings, manual, {
          accessibility_score: result.lhr.categories.accessibility?.score ?? null,
          source_output_sha256: sha256Json(result.lhr),
        }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      }
      process.stderr.write(`lighthouse ${testCase.id}\n`);
    }
  } finally {
    await chrome.kill();
  }
  return rows;
}

async function runAlfa(cases, baseUrl, executablePath) {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: CHROME_ARGS });
  const rows = [];
  try {
    for (const testCase of cases) {
      const started = Date.now();
      const page = await browser.newPage();
      try {
        await page.setViewport(VIEWPORT);
        await loadPuppeteerPage(page, `${baseUrl}/${testCase.path}`, testCase);
        const handle = await page.evaluateHandle(() => window.document);
        const input = await AlfaPuppeteer.toPage(handle);
        await handle.dispose();
        const outcomes = [...await AlfaAudit.of(input, alfaRules).evaluate()];
        const failures = outcomes.filter((outcome) => AlfaOutcome.isFailed(outcome));
        const findings = aggregateFindings(failures, (outcome) => outcome.rule.uri, () => 1,
          (outcome) => criteriaFromAlfaRule(outcome.rule));
        const manual = outcomes.filter((outcome) => AlfaOutcome.isCantTell(outcome)).length;
        rows.push(rowFor(testCase, started, findings, manual, {
          source_output_sha256: sha256Json(outcomes.map((outcome) => outcome.toJSON())),
        }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      } finally {
        await page.close();
      }
      process.stderr.write(`alfa ${testCase.id}\n`);
    }
  } finally {
    await browser.close();
  }
  return rows;
}

async function runQualWeb(cases, baseUrl, executablePath) {
  const qualweb = new QualWeb();
  const rows = [];
  await qualweb.start({ maxConcurrency: 1, timeout: 60000 }, { executablePath, headless: true, args: CHROME_ARGS });
  qualweb.pool?.cluster?.setMaxListeners?.(cases.length + 10);
  const modules = [new ACTRules(), new WCAGTechniques(), new BestPractices()];
  try {
    for (const testCase of cases) {
      const started = Date.now();
      const url = `${baseUrl}/${testCase.path}`;
      try {
        const reports = await qualweb.evaluate({
          url,
          modules,
          timeout: 30000,
          waitUntil: 'networkidle0',
          viewport: { mobile: false, landscape: true, resolution: VIEWPORT },
          log: { console: false, file: false },
        });
        const report = reports[url];
        if (!report?.modules) throw new Error('QualWeb returned no module reports');
        const assertions = Object.entries(report.modules).flatMap(([moduleName, moduleReport]) =>
          Object.values(moduleReport?.assertions || {}).map((assertion) => ({ moduleName, assertion })));
        const findings = assertions.filter(({ assertion }) => assertion.metadata?.failed > 0)
          .map(({ moduleName, assertion }) => ({
            rule: `${moduleName}:${assertion.code}`,
            count: assertion.metadata.failed,
            criteria: criteriaFromQualWebAssertion(assertion),
          })).sort((a, b) => a.rule.localeCompare(b.rule));
        const manual = assertions.reduce((sum, { assertion }) => sum + (assertion.metadata?.warning || 0), 0);
        rows.push(rowFor(testCase, started, findings, manual, { source_output_sha256: sha256Json(report) }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      }
      process.stderr.write(`qualweb ${testCase.id}\n`);
    }
  } finally {
    await qualweb.stop();
  }
  return rows;
}

function localVnuEndpoint() {
  assert.ok(process.env.VNU_ENDPOINT, 'VNU_ENDPOINT is required for the Nu Html Checker');
  const endpoint = new URL(process.env.VNU_ENDPOINT);
  assert.ok(['127.0.0.1', 'localhost', 'vnu'].includes(endpoint.hostname),
    'VNU_ENDPOINT must identify the local benchmark service');
  endpoint.searchParams.set('out', 'json');
  return endpoint;
}

async function runNu(cases, baseUrl, executablePath) {
  const endpoint = localVnuEndpoint();
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const rows = [];
  try {
    for (const testCase of cases) {
      const started = Date.now();
      const page = await context.newPage();
      try {
        await loadPage(page, `${baseUrl}/${testCase.path}`, testCase);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: await page.content(),
        });
        if (!response.ok) throw new Error(`Nu Html Checker HTTP ${response.status}`);
        const result = await response.json();
        if (!Array.isArray(result.messages)) throw new Error('Nu Html Checker returned no messages');
        const findings = aggregateFindings(
          result.messages.filter((message) => message.type === 'error'),
          (message) => `vnu:error:${crypto.createHash('sha256').update(message.message).digest('hex').slice(0, 12)}`,
          () => 1,
          () => [],
        );
        const manual = result.messages.filter((message) => message.type !== 'error').length;
        rows.push(rowFor(testCase, started, findings, manual, { source_output_sha256: sha256Json(result) }));
      } catch (error) {
        rows.push(errorRow(testCase, started, error));
      } finally {
        await page.close();
      }
      process.stderr.write(`nu-html-checker ${testCase.id}\n`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return rows;
}

// Rows, lane metrics and the snapshot are in snapshot.mjs (no dependencies, so the
// corpus checks can hold the default lane's output to its earlier bytes).

// ------------------------------------------------------------------ main

let SUITE_NAME = 'latest-browser-served';
let LANE_NAME = DEFAULT_LANE;
let CORPUS_REVISION = '';

async function main() {
  FIXTURE_ROOT = path.resolve(arg('fixture-root', process.env.A11Y_BENCHMARK_ROOT || ''));
  const outDir = arg('out');
  if (!arg('fixture-root') && !process.env.A11Y_BENCHMARK_ROOT || !outDir) {
    console.error('usage: node run.mjs --fixture-root <corpus checkout> --out <directory> [--lane <name>] [--suite <name>] [--tools <ids>] [--chromium <executable>] [--cognium-export <file>] [--allow-unpinned]');
    process.exit(2);
  }
  // `--lane <variant>` (lanes.mjs): a variant of the published lane, written under
  // <out>/<variant>/ and never at <out>/comparison.json. Without it, nothing changes.
  const lane = laneByName(arg('lane', PINS.lane));
  LANE_NAME = lane.name;
  if (lane.variant_of) {
    assert.equal(arg('suite'), undefined, `--suite is fixed by lane ${lane.name}`);
    SUITE_NAME = lane.name;
  } else {
    SUITE_NAME = arg('suite', PINS.lane);
  }
  const allowUnpinned = process.argv.includes('--allow-unpinned');
  const toolIds = arg('tools', (lane.tools ?? DIRECT_TOOL_IDS).join(',')).split(',').map((value) => value.trim()).filter(Boolean);
  for (const id of toolIds) assert.ok(ALL_TOOL_IDS.includes(id), `unknown tool: ${id}`);
  for (const id of toolIds) {
    assert.ok(!lane.tools || lane.tools.includes(id), `lane ${lane.name} runs only ${lane.tools?.join(', ')}; ${id} has no such variant`);
  }
  if (toolIds.includes('cognium')) COGNIUM_EXPORT = path.resolve(arg('cognium-export', ''));

  // ---- corpus identity
  for (const required of ['fixture-families.mjs', 'serve.mjs', 'corpus-manifest.json', 'VERSION']) {
    assert.ok(fs.existsSync(path.join(FIXTURE_ROOT, required)), `fixture checkout is missing ${required}`);
  }
  CORPUS_REVISION = git(FIXTURE_ROOT, ['rev-parse', 'HEAD']);
  const manifestBytes = fs.readFileSync(path.join(FIXTURE_ROOT, 'corpus-manifest.json'));
  const manifestSha = `sha256:${crypto.createHash('sha256').update(manifestBytes).digest('hex')}`;
  const dirty = git(FIXTURE_ROOT, ['status', '--porcelain']) !== '';
  const pinProblems = [];
  if (CORPUS_REVISION !== PINS.corpus.revision) pinProblems.push(`corpus revision ${CORPUS_REVISION}, pinned ${PINS.corpus.revision}`);
  if (manifestSha !== PINS.corpus.manifest_sha256) pinProblems.push(`manifest ${manifestSha}, pinned ${PINS.corpus.manifest_sha256}`);
  if (dirty) pinProblems.push('corpus checkout has local changes');

  // ---- installed tool tree
  for (const [name, wanted] of Object.entries(MANIFEST.dependencies)) {
    const installed = packageJson(name);
    const version = wanted.startsWith('npm:') ? `npm:${installed.name}@${installed.version}` : installed.version;
    if (version !== wanted) pinProblems.push(`${name} ${version} installed, package.json pins ${wanted}`);
  }
  if (pinProblems.length) {
    const text = pinProblems.map((problem) => `  - ${problem}`).join('\n');
    if (!allowUnpinned) {
      console.error(`refusing to run against unpinned inputs:\n${text}\n(--allow-unpinned records them and runs anyway)`);
      process.exit(2);
    }
    console.error(`RUNNING UNPINNED:\n${text}`);
  }

  // ---- cases
  const [{ loadFixtureCases }, { startCorpusServer }] = await Promise.all([
    import(pathToFileURL(path.join(FIXTURE_ROOT, 'fixture-families.mjs')).href),
    import(pathToFileURL(path.join(FIXTURE_ROOT, 'serve.mjs')).href),
  ]);
  const allCases = loadFixtureCases(FIXTURE_ROOT);
  let suite;
  let selectedCases;
  if (SUITE_NAME === 'all') {
    suite = { name: 'all', description: 'All definite broken and corrected browser fixtures.' };
    selectedCases = allCases.filter((testCase) => ['tp', 'safe'].includes(testCase.mode)
      && testCase.expected_outcome !== 'cannot-tell' && testCase.fixture_family !== 'guided');
  } else {
    const suiteFileName = lane.variant_of ? lane.suite : SUITE_NAME;
    const suiteFile = path.join(HERE, 'suites', `${suiteFileName}.json`);
    assert.ok(fs.existsSync(suiteFile), `unknown suite: ${suiteFileName}`);
    suite = JSON.parse(fs.readFileSync(suiteFile, 'utf8'));
    // a variant is named and described as itself, never as the suite it shares
    if (lane.variant_of) suite = { ...suite, name: lane.name, description: lane.description };
    const byId = new Map(allCases.map((testCase) => [testCase.id, testCase]));
    selectedCases = suite.case_ids.map((id) => {
      const testCase = byId.get(id);
      assert.ok(testCase, `suite references unknown case: ${id}`);
      return testCase;
    });
  }
  // `--only id,id`: a smoke subset. The snapshot records it, and a subset is never the lane result.
  const only = arg('only', '');
  if (only) {
    const wanted = new Set(only.split(',').map((value) => value.trim()).filter(Boolean));
    selectedCases = selectedCases.filter((testCase) => wanted.has(testCase.id));
    assert.equal(selectedCases.length, wanted.size, '--only names a case outside the suite');
    suite = { ...suite, name: `${suite.name} (subset of ${selectedCases.length})` };
  }
  const corpusManifest = JSON.parse(manifestBytes);
  const humanProtocols = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'protocols/protocols.json'), 'utf8'));

  // ---- browser
  const executablePath = path.resolve(arg('chromium', process.env.CHROMIUM_PATH || chromium.executablePath()));
  assert.ok(fs.existsSync(executablePath),
    `no Chromium at the Playwright ${packageVersion('playwright')} default path; pass --chromium <executable>`);
  const browserSource = arg('chromium') || process.env.CHROMIUM_PATH
    ? 'external executable (--chromium)'
    : `Playwright ${packageVersion('playwright')} bundled build`;
  const probe = await chromium.launch({ executablePath });
  const browserVersion = probe.version();
  await probe.close();

  const server = startCorpusServer({ root: FIXTURE_ROOT, host: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const runners = {
    cognium: runCognium, axe: runAxe, 'pa11y-htmlcs': runPa11y, ibm: runIbm,
    lighthouse: runLighthouse, alfa: runAlfa, qualweb: runQualWeb, 'nu-html-checker': runNu,
  };
  const versionOf = {
    axe: () => packageVersion('axe-core'),
    'pa11y-htmlcs': () => packageVersion('pa11y'),
    ibm: () => packageVersion('accessibility-checker'),
    lighthouse: () => packageVersion('lighthouse'),
    alfa: () => `rules ${packageVersion('@siteimprove/alfa-rules')}; Puppeteer integration ${packageVersion('@siteimprove/alfa-puppeteer')}`,
    qualweb: () => `core ${packageVersion('@qualweb/core')}; ACT rules ${packageVersion('@qualweb/act-rules')}; WCAG techniques ${packageVersion('@qualweb/wcag-techniques')}; best practices ${packageVersion('@qualweb/best-practices')}`,
    'nu-html-checker': () => {
      assert.match(process.env.VNU_VERSION || '', /^\d+\.\d+\.\d+$/, 'VNU_VERSION must pin the local Nu Html Checker service');
      assert.match(process.env.VNU_REVISION || '', /^[a-f0-9]{7,40}$/, 'VNU_REVISION must pin the local Nu Html Checker revision');
      assert.match(process.env.VNU_IMAGE_DIGEST || '', /^sha256:[a-f0-9]{64}$/, 'VNU_IMAGE_DIGEST must pin the local Nu Html Checker image');
      return `${process.env.VNU_VERSION} (${process.env.VNU_REVISION}); image ${process.env.VNU_IMAGE_DIGEST}`;
    },
  };

  const tools = {};
  try {
    for (const id of toolIds) {
      console.log(`${TOOL_LABELS[id]}: ${selectedCases.length} pages`);
      const startedAt = new Date().toISOString();
      const result = await runners[id](selectedCases, baseUrl, executablePath);
      const completedAt = new Date().toISOString();
      tools[id] = toolEntry({
        id,
        label: TOOL_LABELS[id],
        version: id === 'cognium' ? null : versionOf[id](),
        result,
        startedAt,
        completedAt,
        ibmEngine: IBM_ENGINE,
        lineage: TOOL_LINEAGE[id],
      });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  let runnerRevision = null;
  let runnerDirty = null;
  try {
    runnerRevision = git(HERE, ['rev-parse', 'HEAD']);
    runnerDirty = git(HERE, ['status', '--porcelain', '--', '.']) !== '';
  } catch { /* not a git checkout */ }

  const snapshot = buildSnapshot({
    laneName: LANE_NAME,
    generated: new Date().toISOString().slice(0, 10),
    suite,
    corpus: {
      repository: corpusManifest.corpus.id,
      version: `v${fs.readFileSync(path.join(FIXTURE_ROOT, 'VERSION'), 'utf8').trim()}`,
      revision: CORPUS_REVISION,
      manifest_sha256: manifestSha,
    },
    coverage: {
      corpus_cases: corpusManifest.counts.cases,
      corpus_families: corpusManifest.counts.families,
      selected_cases: selectedCases.length,
      not_selected_cases: corpusManifest.counts.cases - selectedCases.length,
      human_protocols: humanProtocols.protocols.length,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      browser: `Chromium ${browserVersion}`,
      browser_source: browserSource,
    },
    runner: {
      repository: 'cogniumhq/a11y-benchmark',
      path: 'comparison',
      revision: runnerRevision,
      local_changes: runnerDirty,
      pins_sha256: sha256File(path.join(HERE, 'pins.json')),
      package_lock_sha256: sha256File(path.join(HERE, 'package-lock.json')),
      unpinned: pinProblems,
    },
    toolIds,
    selectedCases,
    tools,
  });

  // the default lane writes <out>/comparison.json as it always has; a variant, <out>/<variant>/comparison.json
  const outFile = snapshotFile(outDir, LANE_NAME);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log('\n| Tool | Known-defect cases target-detected | Expected criteria matched | Corrected controls target-clean | Errors |');
  console.log('|---|---:|---:|---:|---:|');
  for (const id of toolIds) {
    const s = tools[id].summary;
    console.log(`| ${tools[id].label} ${tools[id].version} | ${s.tp_pages_with_target_findings}/${s.tp_cases} | ${s.expected_criteria_matched}/${s.expected_criteria} | ${s.safe_pages_without_target_findings}/${s.safe_cases} | ${s.errors} |`);
  }
  console.log(`\nChromium ${browserVersion} (${browserSource}); wrote ${outFile}`);
  if (lane.variant_of) console.log(`VARIANT ${lane.name} of ${lane.variant_of}: publish apart, labelled; never quote it as ${lane.variant_of}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
