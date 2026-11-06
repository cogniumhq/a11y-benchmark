// Sanitized import of the journey-pages VARIANT: one Cognium Conformis site scan per journey case.
//
//   node import-cognium-journeys.mjs --source <dir holding one report dir per case id> \
//        --fixture-root <corpus checkout> --out <export.json> [--conformis-revision <sha>]
//
// Each journey case of the lane is its own subject (`cognium/journey-pages/<case id>.yaml`,
// written by `node lanes.mjs write-journey-subjects`): its entry points are the case's
// declared `steps` pages, with no flows. `<source>/<case id>/` is what
//
//   npm run a11y:site -- --subject <subject.yaml> --live --out <source>/<case id>
//
// writes in cogniumhq/conformis. The broken and the corrected version of a journey are
// separate subjects and no journey is pooled with another: pooled into one site, a
// site-anchored finding from one journey's pages would land on every other journey,
// corrected controls included.
//
// Attribution. A WCAG finding the scan anchors to the site (relationships between pages:
// 3.2.3, 3.2.4, 3.2.6, 3.3.7) is attributed to that subject's journey case, and so is a
// finding anchored to any of the case's declared steps pages. Each row says how many
// findings came from each (`attribution`). A finding anchored to a page that is not one
// of the case's steps is refused: the subject declared no such page.
//
// It keeps what import-cognium.mjs keeps (control ids, mapped criteria, counts, the number
// of abstaining records) and refuses what it refuses: run errors, page-build failures,
// capture misses, non-reproduced pages, records outside the proofgraph, flows, a report of
// another subject and a missing case. The export names its lane, and a run of the default
// lane refuses it.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertVariantPath, journeyCases, journeySubjectId, laneBlock, laneByName } from './lanes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const JOURNEY_LANE = 'latest-browser-served-journey-pages';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

/** The graph that holds every page the subject declared. */
function allPagesGraph(dir, report) {
  const allPages = path.join(dir, 'proofgraph-all-pages.json');
  if (fs.existsSync(allPages)) return fs.readFileSync(allPages);
  // with no WCAG-EM sample the claim is every page, and the scan writes only proofgraph.json
  assert.equal(report['derived-from']?.proofgraphs?.['all-pages'], undefined,
    `${dir}: the report names an all-pages proofgraph that is not there`);
  return fs.readFileSync(path.join(dir, 'proofgraph.json'));
}

/** One journey case's row: every WCAG finding on the site or on its steps pages. */
export function journeyRow(testCase, graph) {
  const steps = new Set(testCase.steps);
  const grouped = new Map();
  const reviewRecords = new Set();
  const anchorOf = new Map(); // record id -> { anchor, count }, each record once
  let nodes = 0;
  for (const node of graph.nodes || []) {
    const criterion = /^wcag@2\.2:(\d+\.\d+\.\d+)$/.exec(String(node.obligation || ''))?.[1];
    const page = node.anchorSet?.type === 'product' ? node.anchorSet.content : null;
    if (!criterion || !page) continue;
    const anchor = page === 'site' ? 'site' : 'page';
    assert.ok(anchor === 'site' || steps.has(page),
      `${testCase.id}: a WCAG node is anchored to ${page}, which is not one of the case's declared steps`);
    nodes += 1;
    for (const recordId of node.records || []) {
      const witness = graph.witnesses?.[recordId];
      if (!witness) continue;
      if (witness.verdict === 'abstain') reviewRecords.add(recordId);
      if (witness.verdict !== 'deviation') continue;
      const rule = witness.control || 'unknown-control';
      const item = grouped.get(rule) || { rule, criteria: new Set(), records: new Map() };
      item.criteria.add(criterion);
      if (!item.records.has(recordId)) {
        const count = Array.isArray(witness.failing) && witness.failing.length
          ? witness.failing.length
          : Math.max(1, Number(witness.counts?.deviations) || 0);
        item.records.set(recordId, count);
        anchorOf.set(recordId, { anchor, count });
      }
      grouped.set(rule, item);
    }
  }
  assert.ok(nodes, `Cognium proofgraph has no WCAG nodes for journey case ${testCase.id}`);
  const findings = [...grouped.values()].map((item) => ({
    rule: item.rule,
    count: [...item.records.values()].reduce((sum, count) => sum + count, 0),
    criteria: [...item.criteria].sort(),
  })).sort((a, b) => a.rule.localeCompare(b.rule));
  const countAt = (anchor) => [...anchorOf.values()]
    .filter((record) => record.anchor === anchor).reduce((sum, record) => sum + record.count, 0);
  return {
    id: testCase.id,
    path: testCase.path,
    automated_findings: findings.reduce((sum, finding) => sum + finding.count, 0),
    manual_review_items: reviewRecords.size,
    found_criteria: [...new Set(findings.flatMap((finding) => finding.criteria))].sort(),
    findings,
    attribution: {
      subject: journeySubjectId(testCase.id),
      steps_pages: testCase.steps.length,
      site_anchored_findings: countAt('site'),
      page_anchored_findings: countAt('page'),
    },
  };
}

export async function importCogniumJourneys({ source, fixtureRoot, suite, output, conformisRevision = null }) {
  const lane = laneByName(JOURNEY_LANE);
  assert.equal(suite.name, lane.suite, `the journey-pages lane reads suite ${lane.suite}`);
  assertVariantPath(output, lane.name);
  assert.ok(fs.existsSync(path.join(fixtureRoot, 'fixture-families.mjs')), 'fixture checkout is missing');
  const { loadFixtureCases } = await import(pathToFileURL(path.join(fixtureRoot, 'fixture-families.mjs')).href);
  const cases = journeyCases(loadFixtureCases(fixtureRoot), suite);
  const sourceDir = path.resolve(source);

  const subjects = [];
  const rows = [];
  let first = null;
  for (const testCase of cases) {
    const dir = path.join(sourceDir, testCase.id);
    assert.ok(fs.existsSync(path.join(dir, 'report.json')), `no report for journey case ${testCase.id}: a case the product never scanned is not a miss`);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    const subjectId = journeySubjectId(testCase.id);
    assert.equal(report.subject?.id, subjectId, `${testCase.id}: the report is of subject ${report.subject?.id}, not ${subjectId}`);
    assert.equal(report.counts?.['run-errors'], 0, `${testCase.id}: Cognium report has run errors`);
    assert.equal(report.counts?.['outside-the-proofgraph'], 0, `${testCase.id}: Cognium report has records outside the proofgraph`);
    assert.equal(report.hydration?.failed, 0, `${testCase.id}: Cognium report has page-build failures`);
    assert.equal(report.hydration?.['capture-misses'], 0, `${testCase.id}: Cognium report has incomplete capture dependencies`);
    assert.equal(report.hydration?.reproduced, report.hydration?.pages, `${testCase.id}: Cognium report has non-reproducible pages`);
    assert.ok(report.hydration?.pages >= testCase.steps.length, `${testCase.id}: the report built fewer pages than the case declares steps`);
    assert.equal(report.flows?.count ?? 0, 0, `${testCase.id}: this lane declares no flows; the report ran some`);
    assert.ok(!report.explore, `${testCase.id}: this lane runs without state exploration; the report used it`);
    const lock = report['derived-from']?.lock || {};
    if (first) {
      assert.deepEqual(lock, first.lock, `${testCase.id}: another Conformis lock than ${cases[0].id}; one lane run is one product version`);
      assert.equal(report.environment?.chromium, first.report.environment?.chromium, `${testCase.id}: another browser build than ${cases[0].id}`);
    } else {
      first = { report, lock, dir };
    }
    const graphBytes = allPagesGraph(dir, report);
    rows.push(journeyRow(testCase, JSON.parse(graphBytes)));
    subjects.push({
      case: testCase.id,
      subject: subjectId,
      pages: report.hydration.pages,
      digest: report.pin,
      started_at: report.captured,
      completed_at: fs.statSync(path.join(dir, 'report.json')).mtime.toISOString(),
      source_artifact_sha256: sha256(graphBytes),
    });
  }

  const sum = (key) => subjects.reduce((n, item) => n + item[key], 0);
  const packVersions = Object.entries(first.lock.packs || {}).map(([id, version]) => `${id}@${version}`);
  const totals = cases.map((testCase) => JSON.parse(fs.readFileSync(path.join(sourceDir, testCase.id, 'report.json'), 'utf8')));
  const exported = {
    schema_version: 2,
    product: 'Cognium',
    suite: lane.name,
    lane: laneBlock(lane.name),
    version: packVersions.join(' + ') || 'unversioned',
    generated: totals.map((report) => report.generated).sort().at(-1),
    run: {
      started_at: subjects.map((item) => item.started_at).sort()[0],
      completed_at: subjects.map((item) => item.completed_at).sort().at(-1),
      repeat: 1,
    },
    fixture: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim() },
    ...(conformisRevision ? { conformis: { repository: 'cogniumhq/conformis', revision: conformisRevision } } : {}),
    source_artifact_sha256: sha256(JSON.stringify(subjects.map((item) => [item.subject, item.source_artifact_sha256]))),
    source_view: 'one subject per journey case: its declared steps pages, as built in the browser; findings on the site or on those pages are attributed to the case',
    flows: { source: 'subject-declaration', count: 0, names: [] },
    capture: {
      digest: subjects.map((item) => item.digest),
      subjects: subjects.length,
      fixture_pages: cases.reduce((n, testCase) => n + testCase.steps.length, 0),
      hydrated_pages: sum('pages'),
      support_pages: Math.max(0, sum('pages') - cases.reduce((n, testCase) => n + testCase.steps.length, 0)),
      capture_misses: totals.reduce((n, report) => n + report.hydration['capture-misses'], 0),
      reproduced_pages: totals.reduce((n, report) => n + report.hydration.reproduced, 0),
      run_errors: totals.reduce((n, report) => n + report.counts['run-errors'], 0),
      outside_the_proofgraph: totals.reduce((n, report) => n + report.counts['outside-the-proofgraph'], 0),
    },
    environment: {
      browser: `Chromium ${first.report.environment?.chromium}`,
      platform: first.report.environment?.platform,
      viewport: first.report.environment?.viewport,
      ...(first.report.environment?.image ? { image: first.report.environment.image } : {}),
      ...(first.report.environment?.fonts ? { fonts: first.report.environment.fonts } : {}),
    },
    versions: {
      packs: first.lock.packs || {},
      catalogs: first.lock.catalogs || {},
      drivers: first.lock.drivers || {},
      datasets: first.lock.datasets || {},
    },
    subjects: subjects.map(({ case: id, subject, pages, source_artifact_sha256 }) => ({ case: id, subject, pages, source_artifact_sha256 })),
    cases: rows,
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
  const conformisRevision = option('--conformis-revision', null);
  if (!source || !fixtureRoot || !output) {
    console.error('usage: node import-cognium-journeys.mjs --source <dir of per-case report dirs> --fixture-root <corpus> --out <export.json> [--conformis-revision <sha>]');
    process.exit(2);
  }
  if (conformisRevision) assert.match(conformisRevision, /^[a-f0-9]{40}$/, 'Conformis revision must be a 40-character commit');
  const suite = JSON.parse(fs.readFileSync(path.join(HERE, 'suites', `${laneByName(JOURNEY_LANE).suite}.json`), 'utf8'));
  const exported = await importCogniumJourneys({ source, fixtureRoot: path.resolve(fixtureRoot), suite, output, conformisRevision });
  console.log(`wrote ${output}: ${exported.cases.length} journey cases in ${exported.subjects.length} subjects, ${exported.version}`);
  console.log(`VARIANT ${JOURNEY_LANE}: publish apart, labelled; never quote it as ${exported.lane.variant_of}`);
}
