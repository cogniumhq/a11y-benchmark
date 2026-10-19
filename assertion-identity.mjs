// A stable digest of what the corpus asserts about one case.
//
// Adjudication records a judgement about a single assertion: whether
// `min_criteria[criterion]` on this case is correct. That judgement should
// survive everything that does not change the assertion, and expire the moment
// something does.
//
// Two coarser keys were tried first and both expired work nobody had asked a
// question about:
//
//   corpus digest  -- adding the `aaa` and `native` families expired all 72
//                     evidence-ledger records at once.
//   family digest  -- changing `method` metadata on the `aaa` family expired 13
//                     reviewed decisions whose fixtures and ground truth were
//                     untouched (#51). Measured again at the time of #52: of 26
//                     undeclared-finding records the family rule called stale,
//                     23 had an unchanged assertion.
//
// So the digest covers the case's identity and its ground truth, and nothing
// else. `method`, `notes`, `user_needs`, `state_dependency`, `journey`,
// `input_at` and every sibling case in the family can move without touching it.
//
// What is deliberately *in*:
//   case_id           -- the identity the decision is about
//   min_criteria      -- what a tool should report, and how many times
//   must_not_report   -- what a tool must not report
//
// `must_not_report` belongs here even though decisions are keyed on a
// `min_criteria` entry: the pair is the assertion. Moving a criterion from one
// to the other inverts what the case claims while leaving both fields
// individually "present", and that must expire a review.

import crypto from 'node:crypto';

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

/**
 * The digest of one case's identity and ground truth.
 *
 * Keys are sorted so that a regeneration which happens to emit `min_criteria`
 * in a different order does not read as a changed assertion. The count values
 * are kept: asserting a criterion twice is a different claim from asserting it
 * once.
 */
export function assertionDigest(fixture) {
  const minCriteria = Object.fromEntries(
    Object.entries(fixture.min_criteria ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const mustNotReport = [...(fixture.must_not_report ?? [])].sort();
  return sha256(JSON.stringify({
    case_id: fixture.id,
    min_criteria: minCriteria,
    must_not_report: mustNotReport,
  }));
}

/** `case_id` -> assertion digest, for every case in the corpus. */
export function assertionDigests(corpus) {
  return new Map([...corpus.cases.values()].map((fixture) => [fixture.id, assertionDigest(fixture)]));
}
