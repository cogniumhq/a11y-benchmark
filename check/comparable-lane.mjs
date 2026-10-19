// Restate a tool's own benchmark output in a published bundle's metric family.
//
//   node check/comparable-lane.mjs <published-result.json> <tool-rows.json> [--json out]
//
// A vendor's own harness and a published bundle rarely measure the same set of
// pages. Conformis' `bench:a11y-benchmark` runs all 315 labelled pages; the
// published `latest-browser-served` bundle scores 214 of the 270 corpus cases.
// Comparing those two recall figures directly is meaningless, and the error is
// invisible because both are honest numbers about different denominators.
//
// This takes the lane from the published result — every execution carries its
// `case_path` — restricts the tool's rows to exactly those pages, and applies
// the published definitions.
//
// THE DENOMINATOR TRAP, which is the reason this file exists.
//
// The published bundle counts **every non-control case in the lane** as a
// defect case: 214 cases = 110 defect + 104 control, with nothing set aside.
// A tool's own harness may classify some pages as `other` or `cannot-tell` and
// exclude them from scoring — Conformis excludes 10 of exactly those.
//
// Score the tool's way and you get 57/100 = 57.0%. Score the published way and
// you get 58/110 = 52.7%. The first is not a better result, it is a smaller
// denominator; measured against the published 1.2.1 figure of 47/110 it would
// overstate the gain by more than four points. So `defectCases` here is
// deliberately "not a control", never "the tool agreed it was scoreable".
//
// A tool row needs four fields:
//   path          corpus-relative page, matching the bundle's `case_path`
//   expectation   "must-not-report" marks a control; anything else is a defect
//   criteria      the WCAG criteria the page declares
//   hitCriteria   the declared criteria the tool actually reported

import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

/** The set of corpus pages a published result actually measured. */
export function laneOf(publishedResult) {
  const lane = new Set();
  for (const execution of publishedResult.executions ?? []) {
    if (execution.case_path) lane.add(execution.case_path);
  }
  return lane;
}

/**
 * Score tool rows against one lane, using the published definitions.
 *
 * `missing` is reported rather than silently skipped: a lane case the tool
 * never ran is not a miss, it is an incomparable run, and quietly dropping it
 * shrinks the denominator in the tool's favour.
 */
export function scoreLane(rows, lane) {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const missing = [...lane].filter((p) => !byPath.has(p)).sort();
  const present = [...lane].filter((p) => byPath.has(p)).map((p) => byPath.get(p));

  const isControl = (row) => row.expectation === 'must-not-report';
  const declared = (row) => new Set(row.criteria ?? []);
  const hit = (row) => {
    const want = declared(row);
    return new Set((row.hitCriteria ?? []).filter((c) => want.has(c)));
  };

  const controls = present.filter(isControl);
  // Deliberately "not a control" — see the denominator note above.
  const defects = present.filter((row) => !isControl(row));

  return {
    cases: present.length,
    missing,
    defectCases: defects.length,
    defectCasesTargetDetected: defects.filter((row) => hit(row).size > 0).length,
    expectedCriteria: defects.reduce((n, row) => n + declared(row).size, 0),
    expectedCriteriaMatched: defects.reduce((n, row) => n + hit(row).size, 0),
    controlCases: controls.length,
    controlsTargetClean: controls.filter((row) => hit(row).size === 0).length,
    missedDefectCases: defects.filter((row) => hit(row).size === 0)
      .map((row) => row.path).sort(),
  };
}

const rate = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length < 2) {
    console.error('usage: node check/comparable-lane.mjs <published-result.json> '
      + '<tool-rows.json> [--json <file>]');
    return 2;
  }
  const [publishedFile, rowsFile] = files;
  const published = readJson(publishedFile);
  const source = readJson(rowsFile);
  const rows = Array.isArray(source) ? source : source.rows;
  if (!Array.isArray(rows)) {
    console.error(`${rowsFile}: expected an array of rows, or an object with a "rows" array`);
    return 2;
  }

  const lane = laneOf(published);
  const scored = scoreLane(rows, lane);

  console.log(`lane            ${lane.size} cases from ${path.basename(publishedFile)}`);
  console.log(`tool rows       ${rows.length}`);
  if (scored.missing.length) {
    console.log(`NOT RUN         ${scored.missing.length} lane case(s) absent from the tool run`);
    for (const p of scored.missing.slice(0, 5)) console.log(`                  ${p}`);
    console.log('                the comparison below is incomplete');
  }
  console.log('');
  console.log(`case recall       ${scored.defectCasesTargetDetected}/${scored.defectCases}`
    + ` = ${rate(scored.defectCasesTargetDetected, scored.defectCases)}`);
  console.log(`criterion recall  ${scored.expectedCriteriaMatched}/${scored.expectedCriteria}`
    + ` = ${rate(scored.expectedCriteriaMatched, scored.expectedCriteria)}`);
  console.log(`controls clean    ${scored.controlsTargetClean}/${scored.controlCases}`
    + ` = ${rate(scored.controlsTargetClean, scored.controlCases)}`);

  const out = argv.indexOf('--json');
  if (out >= 0 && argv[out + 1]) {
    fs.writeFileSync(argv[out + 1], `${JSON.stringify(scored, null, 2)}\n`);
    console.log(`\nwrote ${argv[out + 1]}`);
  }
  return scored.missing.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('comparable-lane.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
