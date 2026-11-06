// The Cognium importer reads the AAA candidates in a site scan's `beyondClaim` block and
// reports them on a line of their own. They must never change the A/AA export: the A/AA
// rows here are compared byte for byte with what the importer wrote before it read
// `beyondClaim` (expected-export-a-aa.json, made by the previous importer on this fixture).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { importCognium, importBeyondClaim, beyondClaimLine } from '../comparison/import-cognium.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = path.join(ROOT, 'check/fixtures/cognium-beyond-claim');
const IMPORTER = path.join(ROOT, 'comparison/import-cognium.mjs');
const SUITE_ARG = path.relative(path.join(ROOT, 'comparison/suites'), path.join(FIXTURE, 'suite'));
const COMPLETED = new Date('2026-11-04T01:00:00Z');
const read = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE, name), 'utf8'));
const suite = read('suite.json');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

function reportDir(withBeyondClaim) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cognium-import-'));
  const graphFile = path.join(dir, 'proofgraph-all-pages.json');
  if (withBeyondClaim) {
    const graph = read('proofgraph-a-aa.json');
    graph.beyondClaim = read('beyond-claim.json');
    fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2));
  } else {
    fs.copyFileSync(path.join(FIXTURE, 'proofgraph-a-aa.json'), graphFile);
  }
  fs.copyFileSync(path.join(FIXTURE, 'report.json'), path.join(dir, 'report.json'));
  fs.utimesSync(path.join(dir, 'report.json'), COMPLETED, COMPLETED);
  return dir;
}

async function run(withBeyondClaim) {
  const source = reportDir(withBeyondClaim);
  const output = path.join(source, 'out', 'export.json');
  const exported = await importCognium({ source, fixtureRoot: ROOT, suite, output });
  return { exported, text: fs.readFileSync(output, 'utf8'), source };
}

const expected = fs.readFileSync(path.join(FIXTURE, 'expected-export-a-aa.json'), 'utf8')
  .replace('<fixture-commit>', commit);

test('a report without beyondClaim exports exactly what the importer exported before', async () => {
  const { text, exported } = await run(false);
  assert.equal(text, expected);
  assert.equal('beyond_claim' in exported, false);
});

test('beyondClaim leaves every A/AA byte of the export unchanged', async () => {
  const plain = JSON.parse(expected);
  const { exported } = await run(true);
  assert.ok(exported.beyond_claim, 'the AAA block was not exported');
  const aOnly = structuredClone(exported);
  delete aOnly.beyond_claim;
  // The source digest is of the graph file, which now also holds the beyondClaim block.
  assert.notEqual(aOnly.source_artifact_sha256, plain.source_artifact_sha256);
  aOnly.source_artifact_sha256 = plain.source_artifact_sha256;
  assert.equal(`${JSON.stringify(aOnly, null, 2)}\n`, expected);
});

test('AAA candidates are exported apart and never enter an A/AA row', async () => {
  const { exported } = await run(true);
  assert.deepEqual(exported.beyond_claim, {
    level: 'AAA',
    obligations: ['1.4.6', '2.1.3', '2.4.9'],
    cases: [{
      id: 'keyboard-div_button',
      path: 'keyboard/div_button.html',
      automated_findings: 4,
      manual_review_items: 1,
      found_criteria: ['2.1.3', '2.4.9'],
      findings: [
        { rule: 'html/keyboard-operable', count: 3, criteria: ['2.1.3'] },
        { rule: 'html/link-purpose-link-only', count: 1, criteria: ['2.4.9'] },
      ],
    }],
  });
  for (const row of exported.cases) {
    for (const criterion of row.found_criteria) assert.ok(!['1.4.6', '2.1.3', '2.4.9'].includes(criterion));
  }
  assert.equal(importBeyondClaim(undefined, []), null);
  assert.throws(() => importBeyondClaim({ level: 'AA', nodes: [], witnesses: {} }, []), /not the AAA view/);
});

test('the CLI keeps its A/AA line and prints an AAA line of its own', () => {
  const lines = (withBeyondClaim) => {
    const source = reportDir(withBeyondClaim);
    const out = path.join(source, 'export.json');
    const stdout = execFileSync(process.execPath, [IMPORTER, '--source', source, '--fixture-root', ROOT,
      '--out', out, '--suite', SUITE_ARG], { encoding: 'utf8' });
    return stdout.replaceAll(out, '<out>').trimEnd().split('\n');
  };
  const plain = lines(false);
  const aaa = lines(true);
  assert.equal(plain[0], 'wrote <out>: 2 pages, a11y/html@0.0.0-fixture');
  assert.equal(aaa[0], plain[0]);
  assert.equal(plain[1], 'AAA (beyond the claim, not in the A/AA count): no beyondClaim block in this report');
  assert.equal(aaa[1], 'AAA (beyond the claim, not in the A/AA count): 4 findings and 1 review items '
    + 'on 1 of 2 pages; criteria found: 2.1.3, 2.4.9');
  assert.equal(aaa.length, 2);
  assert.equal(beyondClaimLine({ cases: [] }), plain[1]);
});
