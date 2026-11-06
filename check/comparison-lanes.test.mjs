// Lane variants of the comparison runner (comparison/lanes.mjs; techspec G-91 BM-18, BM-19).
//
// Three things are pinned here:
//   1. the default lane, `latest-browser-served`, is unchanged: its inputs keep their
//      bytes, and its export and snapshot are byte for byte what the runner wrote before
//      variants existed (expected-*-default.json were written by the master-branch code
//      at dd0ff19 on these fixtures);
//   2. each variant writes only under its own lane name and says it is a variant;
//   3. nothing pools a variant's rows into the default lane: not the runner, not the
//      merge, not the diff and not the scorer.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scoreLane } from './comparable-lane.mjs';
import { importCognium } from '../comparison/import-cognium.mjs';
import { importCogniumJourneys, journeyRow } from '../comparison/import-cognium-journeys.mjs';
import {
  DEFAULT_LANE, JOURNEY_SUBJECT_DIR, LANES, VARIANT_LANES, assertOneLane, bundleName,
  journeySubjectId, journeySubjectYaml, laneOfDocument, snapshotFile,
} from '../comparison/lanes.mjs';
import { buildSnapshot, cogniumRows, toolEntry } from '../comparison/snapshot.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const COMPARISON = path.join(ROOT, 'comparison');
const FIXTURE = path.join(ROOT, 'check/fixtures/comparison-lanes');
const PINS = JSON.parse(fs.readFileSync(path.join(COMPARISON, 'pins.json'), 'utf8'));
const EXPLORE = 'latest-browser-served-explore-2';
const JOURNEYS = 'latest-browser-served-journey-pages';
const COMPLETED = new Date('2026-11-04T01:00:00Z');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const read = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURE, file), 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-lanes-'));

function reportDir(edit = (report) => report) {
  const dir = tmp();
  fs.copyFileSync(path.join(FIXTURE, 'proofgraph-all-pages.json'), path.join(dir, 'proofgraph-all-pages.json'));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(edit(read('report.json')), null, 2));
  fs.utimesSync(path.join(dir, 'report.json'), COMPLETED, COMPLETED);
  return dir;
}

async function exportFor(lane, edit) {
  const source = reportDir(edit);
  const output = path.join(source, lane === DEFAULT_LANE ? 'out' : lane, 'export.json');
  const exported = await importCognium({
    source, fixtureRoot: ROOT, suite: read('suite.json'), output, conformisRevision: 'a'.repeat(40), lane,
  });
  return { exported, text: fs.readFileSync(output, 'utf8') };
}

function snapshotOf(exported, laneName) {
  const input = read('snapshot-input.json');
  const suite = laneName === DEFAULT_LANE ? input.suite
    : { ...input.suite, name: laneName, description: LANES[laneName].description };
  const corpusRevision = input.corpus.revision;
  const now = Date.now;
  Date.now = () => 0;
  try {
    const result = cogniumRows(exported, input.cases, { suiteName: suite.name, corpusRevision, laneName });
    const tools = {
      cognium: toolEntry({
        id: 'cognium', label: 'Cognium Conformis', version: null, result,
        startedAt: input.startedAt, completedAt: input.completedAt, lineage: input.lineage,
      }),
    };
    return buildSnapshot({
      laneName,
      generated: input.generated,
      suite,
      corpus: {
        repository: input.corpusManifest.corpus.id,
        version: `v${input.versionText.trim()}`,
        revision: corpusRevision,
        manifest_sha256: input.corpus.manifest_sha256,
      },
      coverage: {
        corpus_cases: input.corpusManifest.counts.cases,
        corpus_families: input.corpusManifest.counts.families,
        selected_cases: input.cases.length,
        not_selected_cases: input.corpusManifest.counts.cases - input.cases.length,
        human_protocols: input.humanProtocols.protocols.length,
      },
      environment: {
        node: input.node,
        platform: input.platform,
        architecture: input.arch,
        browser: `Chromium ${input.browserVersion}`,
        browser_source: input.browserSource,
      },
      runner: {
        repository: 'cogniumhq/a11y-benchmark',
        path: 'comparison',
        revision: input.runnerRevision,
        local_changes: false,
        pins_sha256: input.fileSha['pins.json'],
        package_lock_sha256: input.fileSha['package-lock.json'],
        unpinned: [],
      },
      toolIds: ['cognium'],
      selectedCases: input.cases,
      tools,
    });
  } finally {
    Date.now = now;
  }
}

const placeholder = (exported) => JSON.parse(JSON.stringify(exported).replaceAll(commit, '<fixture-commit>'));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ------------------------------------------------------------------ 1. the default lane is unchanged

test('the default lane\'s pinned inputs keep their bytes', () => {
  assert.equal(PINS.lane, DEFAULT_LANE);
  assert.deepEqual({
    pins: sha256('comparison/pins.json'),
    suite: sha256('comparison/suites/latest-browser-served.json'),
    subject: sha256('comparison/cognium/latest-browser-served-subject.yaml'),
    package: sha256('comparison/package.json'),
    lock: sha256('comparison/package-lock.json'),
  }, {
    pins: 'ffb6da29e535c72056ad85e7b442ee532787606d9e5dc5ec555f885e93775011',
    suite: '296b834337ef5ff07ebb75d8d6fe2ced77edd2745b7037fe3e85e830cda53632',
    subject: 'decff3c7cfb05f18fe725aa42ca899cecff65e9035856db4772b4d0810a609e1',
    package: '3f4d11bb8a11649e5c0ba416149e30b60aed097405e19fa7f1a7c646a4fc91f1',
    lock: 'f5ccf82768fc24e7a232bc44363d2e573868091833b0a71189dcdb06f780a533',
  });
});

test('the default lane\'s Cognium export is byte-identical to the importer before variants', async () => {
  const { exported, text } = await exportFor(DEFAULT_LANE);
  const expected = fs.readFileSync(path.join(FIXTURE, 'expected-export-default.json'), 'utf8');
  assert.equal(text.replaceAll(commit, '<fixture-commit>'), expected);
  assert.equal('lane' in exported, false);
  assert.equal('explore' in exported, false);
});

test('the default lane\'s snapshot is byte-identical to the runner before variants', () => {
  const exported = read('expected-export-default.json');
  const snapshot = snapshotOf(exported, DEFAULT_LANE);
  assert.equal(json(snapshot), fs.readFileSync(path.join(FIXTURE, 'expected-snapshot-default.json'), 'utf8'));
  assert.equal('lane' in snapshot, false);
});

test('the default lane writes where it always has', () => {
  assert.equal(snapshotFile('/out', DEFAULT_LANE), path.resolve('/out/comparison.json'));
  assert.equal(laneOfDocument(read('expected-snapshot-default.json')), DEFAULT_LANE);
});

test('the default lane refuses a report made with state exploration', async () => {
  await assert.rejects(exportFor(DEFAULT_LANE, (report) => ({ ...report, explore: 2 })),
    /belongs to a variant lane, not latest-browser-served/);
});

// ------------------------------------------------------------------ 2. each variant under its own name

test('every variant is of the published lane, names itself and has its own bundle', () => {
  assert.deepEqual(VARIANT_LANES, [EXPLORE, JOURNEYS]);
  for (const name of VARIANT_LANES) {
    const lane = LANES[name];
    assert.equal(lane.variant_of, DEFAULT_LANE);
    assert.ok(name.startsWith(`${DEFAULT_LANE}-`) && name !== DEFAULT_LANE);
    assert.match(lane.label, /^Variant of latest-browser-served/);
    assert.match(lane.description, /^VARIANT of latest-browser-served, never quoted as that lane/);
    assert.deepEqual(lane.tools, ['cognium']);
    assert.equal(snapshotFile('/out', name), path.resolve(`/out/${name}/comparison.json`));
    assert.equal(bundleName('2026-11-04', 'v0.1.0', name), `2026-11-04-v0.1.0-${name}`);
  }
  assert.equal(bundleName('2026-10-13', 'v0.1.0', DEFAULT_LANE), '2026-10-13-v0.1.0-latest-browser-served');
});

test('the README says each variant is a variant and is never quoted as the lane', () => {
  const readme = fs.readFileSync(path.join(COMPARISON, 'README.md'), 'utf8');
  for (const name of VARIANT_LANES) {
    assert.ok(readme.includes(`\`${name}\``), `README does not name ${name}`);
  }
  assert.match(readme, /never quoted\s+as the `latest-browser-served` lane/);
});

test('explore-2 has the default lane\'s pin, pages and subject, and a depth the report must record', async () => {
  const lane = LANES[EXPLORE];
  assert.equal(lane.suite, DEFAULT_LANE);
  assert.equal(lane.subject, LANES[DEFAULT_LANE].subject);
  assert.equal(lane.explore, 2);
  await assert.rejects(exportFor(EXPLORE), /records state exploration depth 2; this one records none/);
  await assert.rejects(exportFor(EXPLORE, (report) => ({ ...report, explore: true })), /this one records true/);
});

test('explore-2 writes a labelled export and snapshot that differ from the default only where they say so', async () => {
  const { exported } = await exportFor(EXPLORE, (report) => ({ ...report, explore: 2 }));
  assert.equal(exported.suite, EXPLORE);
  assert.equal(exported.lane.name, EXPLORE);
  assert.equal(exported.lane.variant_of, DEFAULT_LANE);
  assert.deepEqual(exported.explore, { depth: 2, recorded_by: 'report.json `explore`' });
  const plain = read('expected-export-default.json');
  assert.deepEqual(placeholder(exported).cases, plain.cases);

  const snapshot = snapshotOf(placeholder(exported), EXPLORE);
  const reference = read('expected-snapshot-default.json');
  assert.equal(snapshot.suite.name, EXPLORE);
  assert.match(snapshot.suite.description, /^VARIANT/);
  assert.equal(snapshot.lane.name, EXPLORE);
  assert.match(snapshot.lane.publish.quote_as, /never as latest-browser-served/);
  assert.equal(snapshot.tools.cognium.source.explore.depth, 2);
  for (const key of ['corpus', 'coverage', 'cases']) assert.deepEqual(snapshot[key], reference[key], key);
  assert.deepEqual(Object.keys(snapshot), ['schema_version', 'generated', 'suite', 'lane',
    ...Object.keys(reference).filter((key) => !['schema_version', 'generated', 'suite'].includes(key))]);
});

test('a variant export must be written under its lane name', async () => {
  const source = reportDir((report) => ({ ...report, explore: 2 }));
  await assert.rejects(importCognium({
    source, fixtureRoot: ROOT, suite: read('suite.json'), output: path.join(source, 'out', 'export.json'), lane: EXPLORE,
  }), /writes only under a path named for it/);
});

test('journey-pages: one committed subject per journey case, its steps at the pinned corpus revision', () => {
  let pinned;
  try {
    pinned = JSON.parse(execFileSync('git', ['show', `${PINS.corpus.revision}:journeys.json`], { cwd: ROOT, encoding: 'utf8' }));
  } catch {
    assert.fail(`the pinned corpus revision ${PINS.corpus.revision} is not in this clone; fetch full history`);
  }
  const suite = JSON.parse(fs.readFileSync(path.join(COMPARISON, 'suites', `${JOURNEYS}.json`), 'utf8'));
  const lane = JSON.parse(fs.readFileSync(path.join(COMPARISON, 'suites', `${DEFAULT_LANE}.json`), 'utf8'));
  assert.equal(suite.name, JOURNEYS);
  assert.equal(suite.variant_of, DEFAULT_LANE);
  assert.deepEqual(suite.case_ids, lane.case_ids.filter((id) => id.startsWith('journey-')));
  assert.equal(suite.case_ids.length, 18);

  const byId = new Map(pinned.cases.map((testCase) => [testCase.id, testCase]));
  const dir = path.join(COMPARISON, JOURNEY_SUBJECT_DIR);
  assert.deepEqual(fs.readdirSync(dir).sort(), suite.case_ids.map((id) => `${id}.yaml`).sort());
  const seen = new Map();
  const ids = new Set();
  for (const id of suite.case_ids) {
    const testCase = byId.get(id);
    const text = fs.readFileSync(path.join(dir, `${id}.yaml`), 'utf8');
    assert.equal(text, journeySubjectYaml(testCase, PINS.corpus.revision), `${id}.yaml is not what lanes.mjs writes`);
    const subject = /^subject: (.+)$/m.exec(text)[1];
    assert.equal(subject, journeySubjectId(id));
    assert.ok(!ids.has(subject));
    ids.add(subject);
    const entries = [...text.matchAll(/^ {2}- \/(.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(entries, testCase.steps);
    assert.doesNotMatch(text, /^flows:/m);
    for (const page of entries) {
      // never pooled: no page is an entry point of two subjects
      assert.equal(seen.get(page), undefined, `${page} is in ${seen.get(page)} and ${id}`);
      seen.set(page, id);
    }
  }
});

test('journey-pages: site-anchored and steps-page findings are attributed to the journey case', () => {
  const broken = { id: 'journey-booking-broken', path: 'journeys/booking/broken/index.html',
    steps: ['journeys/booking/broken/index.html', 'journeys/booking/broken/step2.html', 'journeys/booking/broken/help.html'] };
  const row = journeyRow(broken, read('journeys/journey-booking-broken/proofgraph-all-pages.json'));
  assert.deepEqual(row.findings, [
    { rule: 'AX-09/3.3.7', count: 2, criteria: ['3.3.7'] },
    { rule: 'AX-21/3.2.3', count: 1, criteria: ['3.2.3'] },
  ]);
  assert.deepEqual(row.found_criteria, ['3.2.3', '3.3.7']);
  assert.equal(row.manual_review_items, 1);
  assert.deepEqual(row.attribution, {
    subject: 'a11y-benchmark-journey-pages-journey-booking-broken',
    steps_pages: 3,
    site_anchored_findings: 1,
    page_anchored_findings: 2,
  });
  assert.throws(() => journeyRow({ ...broken, steps: [broken.path] },
    read('journeys/journey-booking-broken/proofgraph-all-pages.json')), /not one of the case's declared steps/);
});

async function journeyExport(edit = () => {}, output = null) {
  const source = path.join(tmp(), JOURNEYS);
  fs.cpSync(path.join(FIXTURE, 'journeys'), source, { recursive: true });
  fs.rmSync(path.join(source, 'suite.json'));
  edit(source);
  return importCogniumJourneys({
    source, fixtureRoot: ROOT, suite: read('journeys/suite.json'),
    output: output ?? path.join(source, 'export.json'),
  });
}

test('journey-pages: the export names its lane, each subject, and the default lane refuses it', async () => {
  const exported = await journeyExport();
  assert.equal(exported.suite, JOURNEYS);
  assert.equal(exported.lane.name, JOURNEYS);
  assert.equal(exported.lane.subjects, 'one-per-journey-case');
  assert.deepEqual(exported.subjects.map((item) => item.subject), [
    'a11y-benchmark-journey-pages-journey-booking-broken',
    'a11y-benchmark-journey-pages-journey-booking-correct',
  ]);
  const [broken, correct] = exported.cases;
  assert.deepEqual(broken.found_criteria, ['3.2.3', '3.3.7']);
  assert.equal(broken.attribution.site_anchored_findings, 1);
  // the corrected journey is its own subject, so the broken journey's site finding never reaches it
  assert.deepEqual(correct.found_criteria, []);
  assert.equal(exported.capture.run_errors, 0);

  const cases = exported.cases.map((row) => ({ id: row.id, mode: row.id.endsWith('broken') ? 'tp' : 'safe', path: row.path,
    min_criteria: row.id.endsWith('broken') ? { '3.2.3': 1, '3.3.7': 1 } : {}, must_not_report: row.id.endsWith('broken') ? [] : ['3.2.3'] }));
  const result = cogniumRows(exported, cases, { suiteName: JOURNEYS, corpusRevision: commit, laneName: JOURNEYS });
  assert.equal(result.rows[0].attribution.subject, 'a11y-benchmark-journey-pages-journey-booking-broken');
  assert.throws(() => cogniumRows(exported, cases, { suiteName: DEFAULT_LANE, corpusRevision: commit, laneName: DEFAULT_LANE }),
    /export is lane latest-browser-served-journey-pages, this run is lane latest-browser-served/);
});

test('journey-pages: refuses a report of another subject, a missing case and a path not named for the lane', async () => {
  await assert.rejects(journeyExport((source) => {
    const file = path.join(source, 'journey-booking-correct/report.json');
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    report.subject.id = 'a11y-benchmark-latest-browser-served';
    fs.writeFileSync(file, JSON.stringify(report));
  }), /is of subject a11y-benchmark-latest-browser-served/);
  await assert.rejects(journeyExport((source) => fs.rmSync(path.join(source, 'journey-booking-correct'), { recursive: true })),
    /no report for journey case journey-booking-correct/);
  await assert.rejects(journeyExport(() => {}, path.join(tmp(), 'export.json')), /writes only under a path named for it/);
});

// ------------------------------------------------------------------ 3. never pooled

test('the runner refuses a variant export in the default lane and the other way round', async () => {
  const input = read('snapshot-input.json');
  const { exported } = await exportFor(EXPLORE, (report) => ({ ...report, explore: 2 }));
  const variant = placeholder(exported);
  const options = { corpusRevision: input.corpus.revision };
  assert.throws(() => cogniumRows(variant, input.cases, { ...options, suiteName: DEFAULT_LANE, laneName: DEFAULT_LANE }),
    /export is lane latest-browser-served-explore-2, this run is lane latest-browser-served/);
  // stripping the lane block does not make it the default lane: the suite still names the variant
  const stripped = { ...variant };
  delete stripped.lane;
  assert.throws(() => cogniumRows(stripped, input.cases, { ...options, suiteName: DEFAULT_LANE, laneName: DEFAULT_LANE }),
    /export is lane latest-browser-served-explore-2/);
  assert.throws(() => cogniumRows(read('expected-export-default.json'), input.cases, { ...options, suiteName: EXPLORE, laneName: EXPLORE }),
    /export is lane latest-browser-served, this run is lane latest-browser-served-explore-2/);
});

test('merge refuses to join a variant snapshot with a default-lane snapshot', async () => {
  const dir = tmp();
  const plain = read('expected-snapshot-default.json');
  const { exported } = await exportFor(EXPLORE, (report) => ({ ...report, explore: 2 }));
  const variant = snapshotOf(placeholder(exported), EXPLORE);
  // made to look like the same suite and case list, so only the lane check can refuse it
  variant.suite = plain.suite;
  fs.writeFileSync(path.join(dir, 'a.json'), json({ ...plain, tool_order: ['axe'], tools: { axe: plain.tools.cognium } }));
  fs.writeFileSync(path.join(dir, 'b.json'), json(variant));
  assert.throws(() => assertOneLane([plain, variant], ['a.json', 'b.json']), /b.json is lane latest-browser-served-explore-2/);
  const merged = spawnSync(process.execPath, [path.join(COMPARISON, 'merge.mjs'), '--out', path.join(dir, 'out.json'),
    path.join(dir, 'a.json'), path.join(dir, 'b.json')], { encoding: 'utf8' });
  assert.notEqual(merged.status, 0);
  assert.match(merged.stderr, /never pooled with another lane/);
  assert.equal(fs.existsSync(path.join(dir, 'out.json')), false);
});

test('diff refuses a variant against the default lane unless told it is across lanes', async () => {
  const dir = tmp();
  const { exported } = await exportFor(EXPLORE, (report) => ({ ...report, explore: 2 }));
  fs.writeFileSync(path.join(dir, 'base.json'), fs.readFileSync(path.join(FIXTURE, 'expected-snapshot-default.json')));
  fs.writeFileSync(path.join(dir, 'variant.json'), json(snapshotOf(placeholder(exported), EXPLORE)));
  const args = [path.join(COMPARISON, 'diff.mjs'), path.join(dir, 'base.json'), path.join(dir, 'variant.json')];
  const refused = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /a variant is not a re-run of its lane/);
  const across = spawnSync(process.execPath, [...args, '--across-lanes'], { encoding: 'utf8' });
  assert.equal(across.status, 0, across.stderr);
  assert.match(across.stdout, /^ACROSS LANES latest-browser-served -> latest-browser-served-explore-2: .*never quote it as a gain/m);
});

test('the scorer refuses variant rows when scoring the default lane', () => {
  const lane = new Set(['a/defect.html']);
  const row = { path: 'a/defect.html', expectation: 'should-report', criteria: ['1.1.1'], hitCriteria: ['1.1.1'] };
  assert.equal(scoreLane([row], lane).defectCasesTargetDetected, 1);
  for (const name of VARIANT_LANES) {
    for (const tagged of [{ ...row, lane: name }, { ...row, lane: { name } }]) {
      assert.throws(() => scoreLane([row, tagged], lane), new RegExp(`a row of lane ${name} cannot be scored as lane latest-browser-served`));
    }
    assert.equal(scoreLane([{ ...row, lane: name }], lane, { laneName: name }).defectCasesTargetDetected, 1);
    assert.throws(() => scoreLane([row], lane, { laneName: name }), /a row of lane latest-browser-served cannot be scored as lane/);
  }
});

test('the scorer CLI refuses a rows file of a variant against the published lane', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'published.json'), JSON.stringify({
    run: { id: '2026-11-02-rerun-v0.1.0-latest-browser-served-cognium' },
    executions: [{ case_path: 'a/defect.html' }],
  }));
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify({
    lane: EXPLORE,
    rows: [{ path: 'a/defect.html', expectation: 'should-report', criteria: ['1.1.1'], hitCriteria: ['1.1.1'] }],
  }));
  const scorer = path.join(ROOT, 'check/comparable-lane.mjs');
  const refused = spawnSync(process.execPath, [scorer, path.join(dir, 'published.json'), path.join(dir, 'rows.json')], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /REFUSED .*a row of lane latest-browser-served-explore-2 cannot be scored as lane latest-browser-served/);
  // a variant's own published result is read from its run id
  fs.writeFileSync(path.join(dir, 'published-variant.json'), JSON.stringify({
    run: { id: `2026-11-05-v0.1.0-${EXPLORE}-cognium` },
    executions: [{ case_path: 'a/defect.html' }],
  }));
  const own = spawnSync(process.execPath, [scorer, path.join(dir, 'published-variant.json'), path.join(dir, 'rows.json')], { encoding: 'utf8' });
  assert.equal(own.status, 0, own.stderr);
  assert.match(own.stdout, new RegExp(`lane +${EXPLORE}: 1 cases`));
});
