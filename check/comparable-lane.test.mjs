// The denominator is the whole point of comparable-lane.mjs, so it is what
// these pin. Everything else about the file is arithmetic.

import assert from 'node:assert/strict';
import test from 'node:test';

import { laneOf, scoreLane } from './comparable-lane.mjs';

const published = {
  executions: [
    { case_path: 'a/defect.html' },
    { case_path: 'a/safe_defect.html' },
    { case_path: 'b/unscoreable.html' },
  ],
};

const rows = [
  { path: 'a/defect.html', expectation: 'should-report', criteria: ['1.1.1', '2.1.1'], hitCriteria: ['1.1.1'] },
  { path: 'a/safe_defect.html', expectation: 'must-not-report', criteria: ['1.1.1'], hitCriteria: [] },
  // The tool set this one aside; the published bundle still counts it.
  { path: 'b/unscoreable.html', expectation: 'cannot-tell', criteria: ['3.3.1'], hitCriteria: [] },
  // Outside the lane entirely — must not affect any figure.
  { path: 'z/not-in-lane.html', expectation: 'should-report', criteria: ['4.1.2'], hitCriteria: ['4.1.2'] },
];

test('the lane is exactly the published case paths', () => {
  assert.deepEqual([...laneOf(published)].sort(),
    ['a/defect.html', 'a/safe_defect.html', 'b/unscoreable.html']);
});

test('a case the tool set aside still counts as a defect case', () => {
  // The trap this file exists for. Published bundles count every non-control
  // lane case; scoring the tool's way would give 1/1 = 100% here instead of
  // 1/2 = 50%, which reads as a better engine and is only a smaller
  // denominator.
  const s = scoreLane(rows, laneOf(published));
  assert.equal(s.defectCases, 2);
  assert.equal(s.defectCasesTargetDetected, 1);
  assert.equal(s.controlCases, 1);
});

test('rows outside the lane are ignored', () => {
  const s = scoreLane(rows, laneOf(published));
  assert.equal(s.cases, 3);
  assert.ok(!s.missedDefectCases.includes('z/not-in-lane.html'));
  // 2 declared on the defect, 1 on the set-aside case; the out-of-lane row's
  // 4.1.2 must not inflate the denominator.
  assert.equal(s.expectedCriteria, 3);
  assert.equal(s.expectedCriteriaMatched, 1);
});

test('only declared criteria count as hits', () => {
  const s = scoreLane([
    { path: 'a/defect.html', expectation: 'should-report', criteria: ['1.1.1'], hitCriteria: ['1.1.1', '9.9.9'] },
  ], new Set(['a/defect.html']));
  assert.equal(s.expectedCriteriaMatched, 1, 'an undeclared criterion is not credit');
});

test('a control that reports a declared criterion is not clean', () => {
  const s = scoreLane([
    { path: 'a/safe.html', expectation: 'must-not-report', criteria: ['1.1.1'], hitCriteria: ['1.1.1'] },
  ], new Set(['a/safe.html']));
  assert.equal(s.controlCases, 1);
  assert.equal(s.controlsTargetClean, 0);
});

test('a lane case the tool never ran is reported, not dropped', () => {
  // Silently skipping it would shrink the denominator in the tool's favour.
  const s = scoreLane([], laneOf(published));
  assert.deepEqual(s.missing,
    ['a/defect.html', 'a/safe_defect.html', 'b/unscoreable.html']);
  assert.equal(s.cases, 0);
});
