// Mapping code: Cognium Conformis native output -> benchmark-result executions.
//
// Conformis has its own benchmark runner (`npm run bench:a11y-benchmark` in
// cogniumhq/conformis) which drives every labelled corpus page through
// `a11y/html` and `tech/html-aria`, one page per run, and writes a JSON file
// whose `rows` carry the product's own verdicts. That file is the native
// output; this adapter maps it, and runs no product itself.
//
// Point it at that file:
//
//   CONFORMIS_BENCH=/path/to/bench-2026-10-18.json \
//   node starter/run.mjs --out out/result.json --config starter/benchmark.conformis.json
//
// The four mapping rules from adapter.example.mjs, and how each is honoured:
//
// 1. Native rule identity is preserved. `native_rule_id` carries the control
//    ids Conformis reported (`AX-10/2.1.1`, …), joined when several controls
//    deviate under one criterion. The criterion never replaces them.
// 2. `examined_count` is always null. Conformis reports how many *controls*
//    evaluated a page, not how many elements a rule looked at. Those are
//    different quantities, and passing the former would be inventing the
//    latter — 0 means "examined nothing" to the scorer, which would be a
//    different and false claim.
// 3. A page the bench did not run is `error`, never a pass. A page the bench
//    ran but could not attribute is reported with `state_reached: false`.
// 4. `cannot-tell` is used where Conformis abstained under a declared
//    criterion — `abstainedUnderDeclared` — rather than being folded into
//    pass. Abstention is a verdict the product actually makes, and collapsing
//    it into "no finding" would overstate confidence in both directions.

import fs from 'node:fs';
import path from 'node:path';

const BENCH = process.env.CONFORMIS_BENCH;

let rowsByPath = null;
let benchMeta = null;

function load() {
  if (rowsByPath) return;
  if (!BENCH) {
    throw new Error('CONFORMIS_BENCH is not set: point it at a bench-*.json from '
      + 'conformis `npm run bench:a11y-benchmark`');
  }
  const bench = JSON.parse(fs.readFileSync(path.resolve(BENCH), 'utf8'));
  if (!Array.isArray(bench.rows)) {
    throw new Error(`${BENCH}: no "rows" array; this is not a conformis bench file`);
  }
  rowsByPath = new Map(bench.rows.map((row) => [row.path, row]));
  benchMeta = {
    head: bench['conformis-head'],
    pin: bench.pin,
    packs: bench.packs,
    date: bench.date,
  };
}

export function describe() {
  load();
  return `cognium-conformis bench import (${benchMeta.head}; packs ${(benchMeta.packs ?? []).join(' + ')}; `
    + `corpus pin ${String(benchMeta.pin).slice(0, 8)})`;
}

/** The native control ids that deviated under one criterion, if any. */
function nativeRuleId(row, criterion) {
  const ids = (row.by ?? []).filter((id) => String(id).includes(criterion));
  return ids.length ? ids.join(' | ') : `conformis.${criterion.replace(/\./g, '-')}`;
}

export async function evaluate({ testCase }) {
  load();
  const row = rowsByPath.get(testCase.path);

  const base = {
    case_id: testCase.id,
    case_path: testCase.path,
    declared_state: testCase.ui_state ?? 'default',
  };

  // The bench covers labelled HTML pages. A case it never ran is not a miss --
  // reporting it as a pass would credit the product for work it did not do --
  // but `error` and `unsupported` say different things and the difference
  // matters to a reader.
  //
  // Out of surface, so `unsupported`: these packs are `a11y/html` and
  // `tech/html-aria`. A .docx or .pdf is a different surface entirely, and the
  // pipeline-integrity cases test what a *scanner pipeline* does (vacuous
  // passes, entry sampling, flow declaration) rather than what a page
  // contains. Calling either an error would report a fault where there is
  // only a scope boundary.
  if (!row) {
    const outOfSurface = /\.(docx|pdf|epub|pptx|xlsx)$/i.test(testCase.path)
      || testCase.path.startsWith('pipeline/');
    if (outOfSurface) {
      return {
        ...base,
        status: 'unsupported',
        state_reached: false,
        target_observability: 'not-observed',
        outcomes: [],
      };
    }
    return {
      ...base,
      status: 'error',
      state_reached: false,
      target_observability: 'not-observed',
      outcomes: [],
      error: {
        code: 'case-not-in-bench',
        message: `${testCase.path} was not run by this bench; the corpus pin may differ`,
      },
    };
  }

  if (row.errors?.length) {
    return {
      ...base,
      status: 'error',
      state_reached: false,
      target_observability: 'not-observed',
      outcomes: [],
      error: { code: 'bench-run-error', message: String(row.errors[0]).slice(0, 200) },
    };
  }

  const hit = new Set(row.hitCriteria ?? []);
  const abstained = new Set(
    (row.abstainedUnderDeclared ?? []).map((id) => String(id).split('/').pop()?.split('-')[0]),
  );

  const criteria = [...new Set([
    ...Object.keys(testCase.min_criteria ?? {}),
    ...(testCase.must_not_report ?? []),
  ])];

  // Some cases declare no criteria at all, deliberately: the corpus notes call
  // them "the case a tool cannot decide" -- a small element flashing at 8Hz, a
  // caption track that exists but says only "[inaudible]". There is nothing for
  // an automated surface to return a verdict against. `unsupported` says that;
  // `completed` with no outcomes would be a claim to have evaluated them, and
  // the schema rejects it for exactly that reason.
  if (criteria.length === 0) {
    return {
      ...base,
      status: 'unsupported',
      state_reached: true,
      target_observability: 'unknown',
      outcomes: [],
    };
  }

  const outcomes = criteria.map((criterion) => {
    const verdict = hit.has(criterion) ? 'fail'
      : (abstained.has(criterion) ? 'cannot-tell' : 'pass');
    return {
      criterion,
      native_rule_id: nativeRuleId(row, criterion),
      verdict,
      findings: verdict === 'fail' ? (row.by ?? []).filter((id) => String(id).includes(criterion)).length : 0,
      // See rule 2 above: Conformis counts controls, not elements.
      examined_count: null,
      evidence: [{
        type: 'manual-note',
        note: `conformis bench ${benchMeta.date}: ${row.expectation}`,
      }],
    };
  });

  return {
    ...base,
    status: 'completed',
    state_reached: true,
    target_observability: 'observed',
    outcomes,
  };
}
