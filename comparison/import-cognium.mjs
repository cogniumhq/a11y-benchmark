// Sanitized import of a Cognium Conformis site-scan report for one comparison suite.
//
//   node import-cognium.mjs --source <report dir> --fixture-root <corpus checkout> \
//        --out <export.json> [--suite latest-browser-served] [--conformis-revision <sha>]
//
// The report directory is what `npm run a11y:site -- --subject <subject> --live --out <dir>`
// writes in cogniumhq/conformis. This reads its all-pages proofgraph (not the sampled
// headline view) and keeps, per declared page: native control ids, the WCAG criteria
// they deviate under, counts and the number of abstaining records. It keeps no local
// path, URL, selector, step, raw evidence, record identifier or report prose.
//
// It refuses a report with run errors, page-build failures, capture misses,
// non-reproduced pages or records outside the proofgraph, and a report that is
// missing any declared page: a page the product never evaluated is not a miss.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function importCognium({ source, fixtureRoot, suite, output, conformisRevision = null }) {
  const sourceDir = path.resolve(source);
  assert.ok(fs.existsSync(path.join(fixtureRoot, 'fixture-families.mjs')), 'fixture checkout is missing');
  const { loadFixtureCases } = await import(pathToFileURL(path.join(fixtureRoot, 'fixture-families.mjs')).href);
  const report = JSON.parse(fs.readFileSync(path.join(sourceDir, 'report.json'), 'utf8'));
  const graphBytes = fs.readFileSync(path.join(sourceDir, 'proofgraph-all-pages.json'));
  const graph = JSON.parse(graphBytes);
  const fixtureById = new Map(loadFixtureCases(fixtureRoot).map((fixture) => [fixture.id, fixture]));
  const cases = suite.case_ids.map((id) => {
    const fixture = fixtureById.get(id);
    assert.ok(fixture, `unknown comparison fixture: ${id}`);
    return fixture;
  });

  assert.equal(report.counts?.['run-errors'], 0, 'Cognium report has run errors');
  assert.equal(report.counts?.['outside-the-proofgraph'], 0, 'Cognium report has records outside the proofgraph');
  assert.equal(report.hydration?.failed, 0, 'Cognium report has page-build failures');
  assert.equal(report.hydration?.['capture-misses'], 0, 'Cognium report has incomplete capture dependencies');
  assert.equal(report.hydration?.reproduced, report.hydration?.pages, 'Cognium report has non-reproducible pages');
  assert.equal(report.flows?.count ?? 0, 0, 'this lane declares no flows; the report ran some');

  const nodesByPage = new Map();
  for (const node of graph.nodes || []) {
    const criterion = /^wcag@2\.2:(\d+\.\d+\.\d+)$/.exec(String(node.obligation || ''))?.[1];
    const page = node.anchorSet?.type === 'product' ? node.anchorSet.content : null;
    if (!criterion || !page || page === 'site') continue;
    const nodes = nodesByPage.get(page) || [];
    nodes.push({ ...node, criterion });
    nodesByPage.set(page, nodes);
  }

  const normalizedCases = cases.map((testCase) => {
    const nodes = nodesByPage.get(testCase.path) || [];
    assert.ok(nodes.length, `Cognium proofgraph has no WCAG nodes for declared page ${testCase.path}`);
    const grouped = new Map();
    const reviewRecords = new Set();
    for (const node of nodes) {
      for (const recordId of node.records || []) {
        const witness = graph.witnesses?.[recordId];
        if (!witness) continue;
        if (witness.verdict === 'abstain') reviewRecords.add(recordId);
        if (witness.verdict !== 'deviation') continue;
        const rule = witness.control || 'unknown-control';
        const item = grouped.get(rule) || { rule, criteria: new Set(), records: new Map() };
        item.criteria.add(node.criterion);
        if (!item.records.has(recordId)) {
          const count = Array.isArray(witness.failing) && witness.failing.length
            ? witness.failing.length
            : Math.max(1, Number(witness.counts?.deviations) || 0);
          item.records.set(recordId, count);
        }
        grouped.set(rule, item);
      }
    }
    const findings = [...grouped.values()].map((item) => ({
      rule: item.rule,
      count: [...item.records.values()].reduce((sum, count) => sum + count, 0),
      criteria: [...item.criteria].sort(),
    })).sort((a, b) => a.rule.localeCompare(b.rule));
    return {
      id: testCase.id,
      path: testCase.path,
      automated_findings: findings.reduce((sum, finding) => sum + finding.count, 0),
      manual_review_items: reviewRecords.size,
      found_criteria: [...new Set(findings.flatMap((finding) => finding.criteria))].sort(),
      findings,
    };
  });

  const lock = report['derived-from']?.lock || {};
  const packVersions = Object.entries(lock.packs || {}).map(([id, version]) => `${id}@${version}`);
  const exported = {
    schema_version: 2,
    product: 'Cognium',
    suite: suite.name,
    version: packVersions.join(' + ') || 'unversioned',
    generated: report.generated,
    run: {
      started_at: report.captured,
      completed_at: fs.statSync(path.join(sourceDir, 'report.json')).mtime.toISOString(),
      repeat: 1,
    },
    fixture: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim() },
    ...(conformisRevision ? { conformis: { repository: 'cogniumhq/conformis', revision: conformisRevision } } : {}),
    source_artifact_sha256: `sha256:${crypto.createHash('sha256').update(graphBytes).digest('hex')}`,
    source_view: 'all declared comparison pages, as built in the browser',
    flows: { source: report.flows?.source ?? 'subject-declaration', count: 0, names: [] },
    capture: {
      digest: report.pin,
      fixture_pages: cases.length,
      hydrated_pages: report.hydration.pages,
      support_pages: Math.max(0, report.hydration.pages - cases.length),
      capture_misses: report.hydration['capture-misses'],
      reproduced_pages: report.hydration.reproduced,
      run_errors: report.counts['run-errors'],
      outside_the_proofgraph: report.counts['outside-the-proofgraph'],
    },
    environment: {
      browser: `Chromium ${report.environment?.chromium}`,
      platform: report.environment?.platform,
      viewport: report.environment?.viewport,
      ...(report.environment?.image ? { image: report.environment.image } : {}),
      ...(report.environment?.fonts ? { fonts: report.environment.fonts } : {}),
    },
    versions: {
      packs: lock.packs || {},
      catalogs: lock.catalogs || {},
      drivers: lock.drivers || {},
      datasets: lock.datasets || {},
    },
    cases: normalizedCases,
  };

  const text = JSON.stringify(exported);
  for (const pattern of [/(?:\/Users\/|\/home\/|\/tmp\/)/, /https?:\/\/(?!127\.0\.0\.1)/]) {
    assert.doesNotMatch(text, pattern, `export would leak a local path or URL: ${pattern}`);
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(exported, null, 2)}\n`);
  return exported;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const source = option('--source');
  const fixtureRoot = option('--fixture-root');
  const output = option('--out');
  const suiteName = option('--suite', 'latest-browser-served');
  const conformisRevision = option('--conformis-revision', null);
  if (!source || !fixtureRoot || !output) {
    console.error('usage: node import-cognium.mjs --source <report dir> --fixture-root <corpus> --out <export.json> [--suite <name>] [--conformis-revision <sha>]');
    process.exit(2);
  }
  if (conformisRevision) assert.match(conformisRevision, /^[a-f0-9]{40}$/, 'Conformis revision must be a 40-character commit');
  const suite = JSON.parse(fs.readFileSync(path.join(HERE, 'suites', `${suiteName}.json`), 'utf8'));
  const exported = await importCognium({ source, fixtureRoot: path.resolve(fixtureRoot), suite, output, conformisRevision });
  console.log(`wrote ${output}: ${exported.cases.length} pages, ${exported.version}`);
}
