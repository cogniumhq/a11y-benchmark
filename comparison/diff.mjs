// Case-by-case comparison of two comparison snapshots, for a reproduction check.
//
//   node diff.mjs <baseline comparison.json> <candidate comparison.json> \
//        [--tools cognium,axe,...] [--as cognium=cognium] [--json out.json]
//
// For every tool present in both (or each `--as baseline=candidate` pair), it
// reports the lane metrics side by side and every case whose outcome differs:
// the declared criteria matched, the cell (T target, o other finding only,
// . nothing, E error) and the native rules that mapped to a declared criterion.
// It refuses two snapshots measured against different corpus revisions or
// manifests, because their ground truths differ, and two lanes (lanes.mjs): a
// variant against the lane it varies is refused unless `--across-lanes` is given,
// and then it is printed as a difference between lanes, never as a gain in either.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { laneOfDocument } from './lanes.mjs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
const options = new Set(['--tools', '--as', '--json']);

export function cell(row) {
  if (!row || row.status === 'error') return 'E';
  if (row.matched_expected_criteria.length > 0) return 'T';
  return row.automated_findings > 0 ? 'o' : '.';
}

export function laneMetrics(rows) {
  const ok = rows.filter((row) => row.status === 'ok');
  const tp = ok.filter((row) => row.mode === 'tp');
  const safe = ok.filter((row) => row.mode === 'safe');
  return {
    defect_cases: tp.length,
    defect_cases_target_detected: tp.filter((row) => row.matched_expected_criteria.length > 0).length,
    expected_criteria: tp.reduce((n, row) => n + row.expected_criteria.length, 0),
    expected_criteria_matched: tp.reduce((n, row) => n + row.matched_expected_criteria.length, 0),
    control_cases: safe.length,
    controls_target_clean: safe.filter((row) => row.matched_expected_criteria.length === 0).length,
    errors: rows.filter((row) => row.status === 'error').length,
  };
}

const targetRules = (row) => (row?.findings || [])
  .filter((finding) => finding.criteria.some((criterion) => row.expected_criteria.includes(criterion)))
  .map((finding) => finding.rule).sort();

export function diffTool(baseRows, candRows) {
  const byId = new Map(candRows.map((row) => [row.id, row]));
  const differences = [];
  for (const base of baseRows) {
    const cand = byId.get(base.id);
    const before = { cell: cell(base), matched: base.matched_expected_criteria || [], rules: targetRules(base) };
    const after = { cell: cell(cand), matched: cand?.matched_expected_criteria || [], rules: targetRules(cand) };
    if (before.cell !== after.cell || before.matched.join() !== after.matched.join()) {
      differences.push({ id: base.id, mode: base.mode, expected: base.expected_criteria, before, after });
    }
  }
  return {
    baseline: laneMetrics(baseRows),
    candidate: laneMetrics(candRows),
    missing_in_candidate: baseRows.filter((row) => !byId.has(row.id)).map((row) => row.id),
    differences,
  };
}

function main() {
  const files = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && !options.has(all[index - 1]));
  if (files.length !== 2) {
    console.error('usage: node diff.mjs <baseline comparison.json> <candidate comparison.json> [--tools a,b] [--as base=cand] [--json out]');
    process.exit(2);
  }
  const [base, cand] = files.map((file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
  assert.equal(base.corpus.revision, cand.corpus.revision, 'different corpus revisions: not comparable');
  assert.equal(base.corpus.manifest_sha256, cand.corpus.manifest_sha256, 'different corpus manifests: not comparable');
  const lanes = [laneOfDocument(base), laneOfDocument(cand)];
  if (lanes[0] !== lanes[1]) {
    assert.ok(process.argv.includes('--across-lanes'),
      `lane ${lanes[0]} against lane ${lanes[1]}: a variant is not a re-run of its lane (--across-lanes prints the difference as such)`);
    console.log(`ACROSS LANES ${lanes[0]} -> ${lanes[1]}: a difference between two lanes, not a change in either; never quote it as a gain`);
  }
  const pairs = option('as')
    ? option('as').split(',').map((pair) => pair.split('='))
    : (option('tools') ? option('tools').split(',') : base.tool_order.filter((id) => cand.tools[id]))
      .map((id) => [id, id]);
  const out = { baseline: { corpus: base.corpus, environment: base.environment }, candidate: { corpus: cand.corpus, environment: cand.environment }, tools: {} };
  for (const [baseId, candId] of pairs) {
    assert.ok(base.tools[baseId], `baseline has no ${baseId}`);
    assert.ok(cand.tools[candId], `candidate has no ${candId}`);
    const result = diffTool(base.tools[baseId].cases, cand.tools[candId].cases);
    out.tools[`${baseId}=${candId}`] = { baseline_version: base.tools[baseId].version, candidate_version: cand.tools[candId].version, ...result };
    const b = result.baseline; const c = result.candidate;
    console.log(`\n${base.tools[baseId].label}: ${base.tools[baseId].version} -> ${cand.tools[candId].version}`);
    console.log(`  defect cases target-detected  ${b.defect_cases_target_detected}/${b.defect_cases} -> ${c.defect_cases_target_detected}/${c.defect_cases}`);
    console.log(`  expected criteria matched     ${b.expected_criteria_matched}/${b.expected_criteria} -> ${c.expected_criteria_matched}/${c.expected_criteria}`);
    console.log(`  controls target-clean         ${b.controls_target_clean}/${b.control_cases} -> ${c.controls_target_clean}/${c.control_cases}`);
    console.log(`  errors                        ${b.errors} -> ${c.errors}`);
    if (result.missing_in_candidate.length) console.log(`  missing in candidate: ${result.missing_in_candidate.join(', ')}`);
    for (const d of result.differences) {
      console.log(`  ${d.id} [${d.mode}; ${d.expected.join(',')}] ${d.before.cell}{${d.before.matched.join(',')}} -> ${d.after.cell}{${d.after.matched.join(',')}}  rules ${d.before.rules.join(' ') || '-'} -> ${d.after.rules.join(' ') || '-'}`);
    }
    if (!result.differences.length) console.log('  identical case outcomes');
  }
  if (option('json')) fs.writeFileSync(path.resolve(option('json')), `${JSON.stringify(out, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
