// The comparison lanes: the published `latest-browser-served` lane and its variants.
//
//   node comparison/lanes.mjs list
//   node comparison/lanes.mjs write-journey-subjects --fixture-root <corpus at pins.corpus.revision>
//
// A variant measures the same corpus revision as the lane it is a variant of, with
// one thing changed on the scanner side. It is published apart, under its own lane
// name and bundle path, and it is never quoted as the lane it varies. Every guard
// that keeps the two apart reads this file:
//
//   - run.mjs writes a variant's snapshot under `<out>/<variant>/`, never at
//     `<out>/comparison.json`, and refuses tools a variant does not define;
//   - run.mjs refuses a Cognium export made for one lane in a run of another;
//   - merge.mjs refuses to join snapshots of two lanes;
//   - diff.mjs refuses to diff two lanes unless told `--across-lanes`, and then
//     prints that the difference is not a change in either lane;
//   - check/comparable-lane.mjs refuses variant rows when scoring the published lane.
//
// The default lane's own output is not touched by any of this: a snapshot or export
// of `latest-browser-served` carries no `lane` block and is byte-identical to what
// the runner wrote before variants existed (check/comparison-lanes.test.mjs).
//
// This module has no dependencies, so the corpus checks can load it without the
// comparison tool tree installed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LANE = 'latest-browser-served';
export const JOURNEY_SUBJECT_DIR = 'cognium/journey-pages';
export const SUBJECT_ORIGIN = 'http://127.0.0.1:4173';

export const LANES = Object.freeze({
  [DEFAULT_LANE]: Object.freeze({
    name: DEFAULT_LANE,
    variant_of: null,
    suite: DEFAULT_LANE,
    tools: null,
    explore: null,
    subjects: 'one-site',
    subject: 'cognium/latest-browser-served-subject.yaml',
  }),
  'latest-browser-served-explore-2': Object.freeze({
    name: 'latest-browser-served-explore-2',
    variant_of: DEFAULT_LANE,
    label: 'Variant of latest-browser-served: Cognium Conformis with state exploration depth 2',
    description: 'VARIANT of latest-browser-served, never quoted as that lane: the same corpus revision, the same 214 pages in the same order and the same subject declaration, scanned by Cognium Conformis with state exploration at depth 2 (`--explore=2`: the inventory acts once more inside a state that holds controls, and the form driver types, picks and submits with every submission aborted). Only Cognium Conformis is run: the direct tools have no such setting.',
    change: 'scanner setting: state exploration depth 2 (`--explore=2`)',
    suite: DEFAULT_LANE,
    tools: Object.freeze(['cognium']),
    explore: 2,
    subjects: 'one-site',
    subject: 'cognium/latest-browser-served-subject.yaml',
  }),
  'latest-browser-served-journey-pages': Object.freeze({
    name: 'latest-browser-served-journey-pages',
    variant_of: DEFAULT_LANE,
    label: 'Variant of latest-browser-served: each journey case scanned as its own subject over its declared steps pages',
    description: 'VARIANT of latest-browser-served, never quoted as that lane: the 18 journey cases of the lane at the same corpus revision. Each journey case is its own subject whose entry points are the case\'s declared `steps` pages, with no flows; the broken and the corrected version of a journey are separate subjects, and no two journeys are pooled into one site. A finding the scan anchors to the site, or to any of the case\'s steps pages, is attributed to that case. Only Cognium Conformis is run.',
    change: 'subject shape: one subject per journey case over its declared `steps` pages, never pooled into one site',
    suite: 'latest-browser-served-journey-pages',
    tools: Object.freeze(['cognium']),
    explore: null,
    subjects: 'one-per-journey-case',
    subject_dir: JOURNEY_SUBJECT_DIR,
  }),
});

export const VARIANT_LANES = Object.freeze(Object.keys(LANES).filter((name) => LANES[name].variant_of));

export function laneByName(name) {
  const lane = LANES[name];
  assert.ok(lane, `unknown lane: ${name} (known: ${Object.keys(LANES).join(', ')})`);
  return lane;
}

export const isVariant = (name) => VARIANT_LANES.includes(name);

/** The bundle directory a lane's results are published under in the results repository. */
export function bundleName(date, corpusVersion, laneName) {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/, 'bundle date must be YYYY-MM-DD');
  assert.match(corpusVersion, /^v\d+\.\d+\.\d+$/, 'corpus version must be vX.Y.Z');
  laneByName(laneName);
  return `${date}-${corpusVersion}-${laneName}`;
}

/** The block a variant's snapshot and export carry. The default lane carries none. */
export function laneBlock(laneName) {
  const lane = laneByName(laneName);
  assert.ok(lane.variant_of, `${laneName} is not a variant and carries no lane block`);
  return {
    name: lane.name,
    variant_of: lane.variant_of,
    label: lane.label,
    change: lane.change,
    subjects: lane.subjects,
    ...(lane.explore ? { explore: lane.explore } : {}),
    publish: {
      bundle: `results/<date>-<corpus version>-${lane.name}`,
      apart_from: lane.variant_of,
      quote_as: `${lane.name} only; never as ${lane.variant_of}, and never summed with or compared as a gain over it`,
    },
  };
}

/**
 * The lane a snapshot, export or row set was measured in. A document with a `lane`
 * block names it; one without is the default lane, unless its suite is named for a
 * variant (a variant document that lost its block is still a variant).
 */
export function laneOfDocument(document) {
  const declared = document?.lane?.name;
  if (declared) return laneByName(declared).name;
  const suite = typeof document?.suite === 'string' ? document.suite : document?.suite?.name;
  const variant = VARIANT_LANES.find((name) => typeof suite === 'string'
    && (suite === name || suite.startsWith(`${name} `)));
  return variant ?? DEFAULT_LANE;
}

/** A variant names itself in free text such as a run id or a bundle name. */
export function variantNamedIn(text) {
  return VARIANT_LANES.find((name) => String(text ?? '').includes(name)) ?? null;
}

/** Refuse documents of more than one lane: they are never pooled. */
export function assertOneLane(documents, labels = documents.map((_, index) => `#${index + 1}`)) {
  const lanes = documents.map(laneOfDocument);
  lanes.forEach((lane, index) => assert.equal(lane, lanes[0],
    `${labels[index]} is lane ${lane}, ${labels[0]} is lane ${lanes[0]}: a variant is published apart and never pooled with another lane`));
  return lanes[0];
}

/** Where run.mjs writes a lane's snapshot: the default lane where it always has, a variant under its own name. */
export function snapshotFile(outDir, laneName) {
  const lane = laneByName(laneName);
  return lane.variant_of
    ? path.join(path.resolve(outDir), lane.name, 'comparison.json')
    : path.join(path.resolve(outDir), 'comparison.json');
}

/** A variant's files go under its own name: refuse an output path that does not carry it. */
export function assertVariantPath(file, laneName) {
  const lane = laneByName(laneName);
  if (!lane.variant_of) return;
  assert.ok(path.resolve(file).split(path.sep).some((segment) => segment.includes(lane.name)),
    `${lane.name} writes only under a path named for it; ${file} is not`);
}

// ------------------------------------------------------------------ journey subjects

export const journeySubjectId = (caseId) => `a11y-benchmark-journey-pages-${caseId}`;

export function journeySubjectYaml(testCase, corpusRevision) {
  assert.ok(Array.isArray(testCase.steps) && testCase.steps.length, `${testCase.id} declares no steps`);
  assert.ok(testCase.steps.includes(testCase.path), `${testCase.id}: its page is not among its steps`);
  return [
    `# Cognium Conformis subject for ${testCase.id} in the latest-browser-served-journey-pages lane.`,
    '#',
    '# VARIANT of latest-browser-served, published apart and never quoted as that lane.',
    '# One subject per journey case: its entry points are exactly the case\'s declared',
    '# `steps`, in order, served by the corpus server from a checkout at corpus revision',
    `# ${corpusRevision}.`,
    '# It declares no flows and is never pooled with another journey.',
    '# Generated by `node comparison/lanes.mjs write-journey-subjects`; do not edit.',
    `subject: ${journeySubjectId(testCase.id)}`,
    'kind: deployed-site',
    `origin: ${SUBJECT_ORIGIN}`,
    'entry-points:',
    ...testCase.steps.map((step) => `  - /${step}`),
    '',
  ].join('\n');
}

export function journeyCases(allCases, suite) {
  const byId = new Map(allCases.map((testCase) => [testCase.id, testCase]));
  return suite.case_ids.map((id) => {
    const testCase = byId.get(id);
    assert.ok(testCase, `suite references unknown case: ${id}`);
    assert.equal(testCase.fixture_family ?? 'journeys', 'journeys', `${id} is not a journey case`);
    return testCase;
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function writeJourneySubjects(fixtureRoot) {
  const pins = readJson(path.join(HERE, 'pins.json'));
  const { execFileSync } = await import('node:child_process');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim();
  assert.equal(revision, pins.corpus.revision, `fixture checkout is ${revision}, the lane pins ${pins.corpus.revision}`);
  const { loadFixtureCases } = await import(pathToFileURL(path.join(fixtureRoot, 'fixture-families.mjs')).href);
  const suite = readJson(path.join(HERE, 'suites', `${LANES['latest-browser-served-journey-pages'].suite}.json`));
  const dir = path.join(HERE, JOURNEY_SUBJECT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const testCase of journeyCases(loadFixtureCases(fixtureRoot), suite)) {
    fs.writeFileSync(path.join(dir, `${testCase.id}.yaml`), journeySubjectYaml(testCase, revision));
  }
  console.log(`wrote ${suite.case_ids.length} subjects under comparison/${JOURNEY_SUBJECT_DIR}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command] = process.argv.slice(2);
  if (command === 'list') {
    for (const lane of Object.values(LANES)) {
      console.log(`${lane.name}${lane.variant_of ? `  VARIANT of ${lane.variant_of}: ${lane.change}` : '  (the published lane)'}`);
    }
  } else if (command === 'write-journey-subjects') {
    const index = process.argv.indexOf('--fixture-root');
    assert.ok(index >= 0 && process.argv[index + 1], 'usage: node lanes.mjs write-journey-subjects --fixture-root <corpus>');
    await writeJourneySubjects(path.resolve(process.argv[index + 1]));
  } else {
    console.error('usage: node comparison/lanes.mjs list | write-journey-subjects --fixture-root <corpus>');
    process.exit(2);
  }
}
