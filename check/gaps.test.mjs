// The weekly lane report: a lost declared criterion fails, a miss that was
// already a miss does not.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyTool, renderReport, reportFromSnapshots, rowsFromCogniumExport, standingMisses } from '../comparison/gaps.mjs';
import { diffTool } from '../comparison/diff.mjs';

const row = (id, mode, expected, matched, findings = []) => ({
  id,
  mode,
  status: 'ok',
  expected_criteria: expected,
  matched_expected_criteria: matched,
  automated_findings: findings.length,
  findings,
});

const snapshot = (cases) => ({
  corpus: { revision: 'abc', manifest_sha256: 'sha256:aa' },
  tool_order: ['cognium'],
  tools: { cognium: { label: 'Cognium Conformis', cases } },
});

test('a known defect that loses a declared criterion is a regression, and one that never matched is not', () => {
  const before = [
    row('patterns-accordion', 'tp', ['4.1.2', '1.3.1'], ['4.1.2'], [{ rule: 'AX-05/4.1.2', criteria: ['4.1.2'] }]),
    row('patterns-alert', 'tp', ['4.1.3'], []),
    row('keyboard-safe_native_button', 'safe', ['4.1.2'], []),
  ];
  const after = [
    row('patterns-accordion', 'tp', ['4.1.2', '1.3.1'], [], [{ rule: 'AX-10/2.1.1', criteria: ['2.1.1'] }]),
    row('patterns-alert', 'tp', ['4.1.3'], []),
    row('keyboard-safe_native_button', 'safe', ['4.1.2'], []),
  ];
  const classified = classifyTool(diffTool(before, after));
  assert.deepEqual(classified.regressions.map((item) => item.id), ['patterns-accordion']);
  assert.deepEqual(classified.falsePositives, []);
  const standing = standingMisses(after);
  assert.equal(standing.completeMisses, 2);
  assert.deepEqual(standing.criteria.find(([criterion]) => criterion === '4.1.3')[1], ['patterns-alert']);
});

test('a corrected control that gains a declared criterion is a false positive', () => {
  const before = [row('color-safe_status', 'safe', ['1.4.1'], [])];
  const after = [row('color-safe_status', 'safe', ['1.4.1'], ['1.4.1'], [{ rule: 'AX-38/1.4.1', criteria: ['1.4.1'] }])];
  const classified = classifyTool(diffTool(before, after));
  assert.deepEqual(classified.falsePositives.map((item) => item.id), ['color-safe_status']);
  assert.equal(standingMisses(after).completeMisses, 0);
});

test('a Conformis export is scored on the baseline case list', () => {
  const baseline = snapshot([
    row('patterns-accordion', 'tp', ['4.1.2', '1.3.1'], ['4.1.2']),
    row('static-input_purpose_missing', 'tp', ['1.3.5'], []),
  ]);
  const exported = {
    cases: [
      { id: 'patterns-accordion', found_criteria: ['2.1.1'], automated_findings: 1, findings: [{ rule: 'AX-10/2.1.1', criteria: ['2.1.1'] }] },
      { id: 'static-input_purpose_missing', found_criteria: ['1.3.5'], automated_findings: 1, findings: [{ rule: 'AX-14/1.3.5-missing', criteria: ['1.3.5'] }] },
    ],
  };
  const report = reportFromSnapshots(baseline, null, { cogniumExport: exported });
  assert.equal(report.fail, true);
  assert.deepEqual(report.tools[0].regressions.map((item) => item.id), ['patterns-accordion']);
  const text = renderReport(report);
  assert.match(text, /patterns-accordion/);
  assert.match(text, /Result: regression/);
  const rows = rowsFromCogniumExport(exported, baseline.tools.cognium.cases);
  assert.deepEqual(rows[1].matched_expected_criteria, ['1.3.5']);
});

test('an unchanged snapshot does not fail', () => {
  const cases = [row('patterns-alert', 'tp', ['4.1.3'], [])];
  const report = reportFromSnapshots(snapshot(cases), snapshot(cases));
  assert.equal(report.fail, false);
  assert.match(renderReport(report), /no regression/);
});
