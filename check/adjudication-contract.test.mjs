import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { partitionDecisions, partitionUndeclared, reconcile, silentAssertions, undeclaredFindings } from '../adjudicate.mjs';
import { assertionDigest } from '../assertion-identity.mjs';
import { loadCorpus } from './scoring.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const corpus = loadCorpus(ROOT);
const manifest = readJson('corpus-manifest.json');
const adjudication = readJson('adjudication.json');

const OUTCOMES = ['correct-unimplemented', 'correct-manual-only', 'correct-pipeline-dependent', 'wrong'];

const resultWith = (executions, name = 'Example') => ({
  format: 'cognium-a11y-benchmark-result',
  format_version: '1.0.0',
  corpus: { repository: 'cogniumhq/a11y-benchmark', revision: 'a'.repeat(40), manifest_sha256: `sha256:${'b'.repeat(64)}` },
  run: {
    id: 'r', started_at: '2026-10-13T09:00:00Z', completed_at: '2026-10-13T09:01:00Z', repeat: 1,
    tool: { name, version: '1.0.0', engine_family: name, tool_surface: 'CLI', independence: 'independent-engine' },
    environment: { os: 'Linux', runtime: 'Node.js 22' },
    privacy: { fixture_data: 'public-synthetic', raw_evidence_published: false },
  },
  executions,
});

const outcome = (criterion, verdict, findings) => ({
  criterion, native_rule_id: 'x', verdict, findings,
  examined_count: 1, evidence: [{ type: 'manual-note', note: 'n' }],
});

const exec = (caseId, outcomes) => ({
  case_id: caseId, case_path: 'f.html', status: 'completed',
  declared_state: 'default', state_reached: true, target_observability: 'observed', outcomes,
});

// --- the committed decisions ------------------------------------------------

test('the adjudication file satisfies its schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  const validate = ajv.compile(readJson('schemas/adjudication.schema.json'));
  assert.equal(validate(adjudication), true, JSON.stringify(validate.errors?.slice(0, 3), null, 2));
});

test('every decision cites a public source and names a reviewer', () => {
  assert.ok(adjudication.decisions.length > 0);
  for (const decision of adjudication.decisions) {
    assert.match(decision.source, /^https:\/\//, `${decision.case_id} has no public source`);
    assert.ok(decision.reviewer.length > 0);
    assert.ok(decision.rationale.length >= 40, `${decision.case_id} rationale is too thin`);
    assert.ok(OUTCOMES.includes(decision.outcome));
  }
});

test('every decision names a case and criterion the corpus actually asserts', () => {
  for (const decision of adjudication.decisions) {
    const fixture = corpus.cases.get(decision.case_id);
    assert.ok(fixture, `${decision.case_id} is not in the corpus`);
    assert.ok(
      Object.keys(fixture.min_criteria ?? {}).includes(decision.criterion),
      `${decision.case_id} does not assert ${decision.criterion}`,
    );
    assert.equal(decision.family, fixture.family);
  }
});

test('decisions are unique per case and criterion', () => {
  const keys = adjudication.decisions.map((row) => `${row.case_id}|${row.criterion}`);
  assert.equal(new Set(keys).size, keys.length, 'an assertion is adjudicated twice');
});

test('no committed decision declares an assertion wrong without saying what to change', () => {
  for (const decision of adjudication.decisions.filter((row) => row.outcome === 'wrong')) {
    assert.ok(decision.notes, `${decision.case_id} is marked wrong with no remedy`);
  }
});

test('the policy states that silence does not settle a question', () => {
  assert.match(adjudication.policy.scope, /not thereby wrong/i);
  assert.match(adjudication.policy.sourcing, /never changed to match current tool behaviour/i);
  assert.match(adjudication.policy.expiry, /assertion/i);
});

// --- expiry is per assertion, not per family and not per corpus -------------
//
// Two coarser keys were tried before this one and both expired reviews nobody
// had questioned: the corpus digest took out all 72 evidence records when two
// families were added, and the family digest took out 13 decisions over a
// metadata edit (#51). These tests pin the granularity so a third attempt at
// "just use the digest we already have" fails loudly.

/** A corpus with one case's ground truth altered, leaving everything else. */
function withChangedAssertion(caseId, mutate) {
  const moved = { ...corpus, cases: new Map(corpus.cases) };
  const fixture = structuredClone(moved.cases.get(caseId));
  mutate(fixture);
  moved.cases.set(caseId, fixture);
  return moved;
}

test('a decision survives metadata changing on its own case', () => {
  const subject = adjudication.decisions[0];
  const moved = withChangedAssertion(subject.case_id, (fixture) => {
    fixture.method = ['interaction', 'state-exploration', 'a-method-it-did-not-have'];
    fixture.notes = 'rewritten note';
    fixture.user_needs = ['memory-support'];
    fixture.state_dependency = 'driven';
    fixture.journey = 'some-other-journey';
  });

  const { current, stale } = partitionDecisions(adjudication, moved);
  assert.deepEqual(stale, [], 'metadata is not part of what the corpus asserts');
  assert.equal(current.size, adjudication.decisions.length);
});

test('a decision survives a sibling case in the same family changing', () => {
  const subject = adjudication.decisions[0];
  const sibling = [...corpus.cases.values()].find(
    (row) => row.family === subject.family && row.id !== subject.case_id,
  );
  assert.ok(sibling, 'need a sibling to make this test meaningful');

  const moved = withChangedAssertion(sibling.id, (fixture) => {
    fixture.min_criteria = { '9.9.9': 1 };
  });

  const { current, stale } = partitionDecisions(adjudication, moved);
  assert.equal(
    stale.some((row) => row.case_id === subject.case_id), false,
    'a decision is about one case, not about its neighbours',
  );
  assert.ok(current.has(`${subject.case_id}|${subject.criterion}`));
});

test('a decision expires when its own min_criteria changes', () => {
  const subject = adjudication.decisions[0];
  const moved = withChangedAssertion(subject.case_id, (fixture) => {
    fixture.min_criteria = { ...fixture.min_criteria, '1.1.1': 1 };
  });

  const { current, stale } = partitionDecisions(adjudication, moved);
  assert.ok(stale.some((row) => row.case_id === subject.case_id));
  assert.match(
    stale.find((row) => row.case_id === subject.case_id).stale_reason,
    /ground truth for .* changed since review/,
  );
  assert.equal(current.has(`${subject.case_id}|${subject.criterion}`), false);
});

test('a decision expires when must_not_report changes', () => {
  // Moving a criterion between min_criteria and must_not_report inverts what
  // the case claims while leaving both fields present, so must_not_report has
  // to be inside the digest.
  const subject = adjudication.decisions[0];
  const moved = withChangedAssertion(subject.case_id, (fixture) => {
    fixture.must_not_report = [...(fixture.must_not_report ?? []), '1.4.1'];
  });

  const { stale } = partitionDecisions(adjudication, moved);
  assert.ok(stale.some((row) => row.case_id === subject.case_id));
});

test('reordering min_criteria is not a change', () => {
  const subject = adjudication.decisions[0];
  const fixture = corpus.cases.get(subject.case_id);
  const keys = Object.keys(fixture.min_criteria ?? {});
  if (keys.length < 2) return; // nothing to reorder

  const moved = withChangedAssertion(subject.case_id, (next) => {
    next.min_criteria = Object.fromEntries(
      keys.slice().reverse().map((key) => [key, fixture.min_criteria[key]]),
    );
  });

  const { stale } = partitionDecisions(adjudication, moved);
  assert.equal(stale.some((row) => row.case_id === subject.case_id), false);
});

test('a decision for a case that no longer exists is reported, not silently dropped', () => {
  const subject = adjudication.decisions[0];
  const moved = { ...corpus, cases: new Map(corpus.cases) };
  moved.cases.delete(subject.case_id);

  const { stale } = partitionDecisions(adjudication, moved);
  assert.ok(stale.some((row) => row.stale_reason.includes('no longer exists')));
});

test('committed decisions are current against the committed corpus', () => {
  const { current, stale } = partitionDecisions(adjudication, corpus);
  assert.deepEqual(stale, [], 'a committed decision must match the assertion it was reviewed against');
  assert.equal(current.size, adjudication.decisions.length);
});

// --- undeclared findings expire by the same rule -----------------------------

test('undeclared findings pin an assertion digest, and it is enforced', () => {
  // These records carried a family digest that nothing ever read, so a review
  // of a pair survived any later rewrite of that pair.
  for (const row of adjudication.undeclared_findings ?? []) {
    assert.match(row.assertion_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal('family_sha256' in row, false);
  }

  const subject = (adjudication.undeclared_findings ?? [])[0];
  const moved = withChangedAssertion(subject.case_id, (fixture) => {
    fixture.min_criteria = { ...fixture.min_criteria, '9.9.9': 1 };
  });

  const { current, stale } = partitionUndeclared(adjudication, moved);
  assert.ok(stale.some((row) => row.case_id === subject.case_id));
  assert.equal(current.has(`${subject.case_id}|${subject.criterion}`), false);
});

test('a stale undeclared review is not counted as reviewed', () => {
  // The bug this closes: `reconcile` mapped every record straight to reviewed,
  // so a rewritten fixture kept an adjudication made about its old form.
  const stale = (reconcile({ corpus, manifest, adjudication, results: [] }).undeclaredStale ?? []);
  for (const row of stale) {
    assert.match(row.stale_reason, /changed since review|no longer exists/);
  }
});

test('the three dragging reviews stay expired after migration', () => {
  // scenario-dragging_required lost 2.5.1 from its ground truth when #54 gave
  // its handles real listeners, so reviews made against the old pair must not
  // be revalidated by the move to assertion digests. They are pinned at the
  // ground truth the reviewer actually saw.
  const { stale } = partitionUndeclared(adjudication, corpus);
  const ids = new Set(stale.map((row) => row.case_id));
  assert.deepEqual([...ids], ['scenario-dragging_required']);
  assert.equal(stale.length, 3);
});

test('every live record pins the digest its case computes today', () => {
  const rows = [...(adjudication.decisions ?? []), ...(adjudication.undeclared_findings ?? [])];
  for (const row of rows) {
    const fixture = corpus.cases.get(row.case_id);
    assert.ok(fixture, `${row.case_id} is not in the corpus`);
    const live = assertionDigest(fixture);
    // Either it matches today (live) or it is one of the records deliberately
    // pinned at older ground truth so that it reads as stale.
    if (row.assertion_sha256 !== live) {
      assert.equal(row.case_id, 'scenario-dragging_required');
    }
  }
});

// --- silence detection ------------------------------------------------------

test('an assertion an engine reports is not silent', () => {
  const fixture = [...corpus.cases.values()].find(
    (row) => row.mode === 'tp' && Object.keys(row.min_criteria ?? {}).length > 0,
  );
  const criterion = Object.keys(fixture.min_criteria)[0];

  const silent = silentAssertions(corpus, [resultWith([exec(fixture.id, [outcome(criterion, 'fail', 1)])])]);
  assert.equal(silent.some((row) => row.case_id === fixture.id && row.criterion === criterion), false);
});

test('a fail with zero findings is still silence', () => {
  const fixture = [...corpus.cases.values()].find(
    (row) => row.mode === 'tp' && Object.keys(row.min_criteria ?? {}).length > 0,
  );
  const criterion = Object.keys(fixture.min_criteria)[0];

  const silent = silentAssertions(corpus, [resultWith([exec(fixture.id, [outcome(criterion, 'fail', 0)])])]);
  assert.ok(silent.some((row) => row.case_id === fixture.id && row.criterion === criterion));
});

test('an engine that evaluated and declined is distinguished from one that never looked', () => {
  const fixture = [...corpus.cases.values()].find(
    (row) => row.mode === 'tp' && Object.keys(row.min_criteria ?? {}).length > 0,
  );
  const criterion = Object.keys(fixture.min_criteria)[0];

  const looked = silentAssertions(corpus, [resultWith([exec(fixture.id, [outcome(criterion, 'pass', 0)])])]);
  const row = looked.find((entry) => entry.case_id === fixture.id && entry.criterion === criterion);
  assert.equal(row.evaluated_by_some_engine, true);

  const never = silentAssertions(corpus, [resultWith([])]);
  const other = never.find((entry) => entry.case_id === fixture.id && entry.criterion === criterion);
  assert.equal(other.evaluated_by_some_engine, false);
});

test('human-judgement cases are never queued for engine adjudication', () => {
  const silent = silentAssertions(corpus, [resultWith([])]);
  assert.equal(silent.some((row) => row.case_id.startsWith('guided-')), false);
});

// --- reconciliation ---------------------------------------------------------

test('reconcile separates reviewed assertions from the backlog', () => {
  const report = reconcile({ corpus, manifest, adjudication, results: [resultWith([])] });

  assert.equal(report.adjudicated.length + report.awaiting.length, report.silent.length);
  assert.ok(report.adjudicated.length > 0, 'the seeded decisions should be recognised');
  assert.ok(report.awaiting.length > 0, 'the remaining backlog stays visible');
  for (const row of report.adjudicated) assert.ok(OUTCOMES.includes(row.outcome));
});

test('a reviewed assertion an engine now reports is surfaced for re-review', () => {
  // The reason for the original decision may no longer hold.
  const decision = adjudication.decisions[0];
  const report = reconcile({
    corpus, manifest, adjudication,
    results: [resultWith([exec(decision.case_id, [outcome(decision.criterion, 'fail', 1)])])],
  });

  assert.ok(
    report.superseded.some((row) => row.case_id === decision.case_id && row.criterion === decision.criterion),
    'a decision whose assertion is now detected must be flagged',
  );
});

test('the backlog is a question, not a verdict', () => {
  // Nothing in reconcile may mark an assertion wrong; only a reviewer can.
  const report = reconcile({ corpus, manifest, adjudication, results: [resultWith([])] });
  for (const row of report.awaiting) {
    assert.equal(row.outcome, undefined, 'the reconciler must not decide an outcome');
  }
});

// --- undeclared findings (#48) ----------------------------------------------

test('the undeclared-findings records satisfy the schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  const validate = ajv.compile(readJson('schemas/adjudication.schema.json'));
  assert.equal(validate(adjudication), true, JSON.stringify(validate.errors?.slice(0, 3), null, 2));
  assert.ok(adjudication.undeclared_findings.length > 0);
});

test('every undeclared finding names a real pair and an undeclared criterion', () => {
  for (const row of adjudication.undeclared_findings) {
    const fixture = corpus.cases.get(row.case_id);
    assert.ok(fixture, `${row.case_id} is not in the corpus`);
    assert.equal(fixture.mode, 'tp', `${row.case_id} is not a defect case`);
    assert.equal(
      Object.keys(fixture.min_criteria ?? {}).includes(row.criterion),
      false,
      `${row.case_id} declares ${row.criterion}, so it is not an undeclared finding`,
    );
    assert.equal(row.family, fixture.family);
    assert.ok(row.engines_agreeing >= 1);
  }
});

test('calling a pair confounded requires naming the remedy', () => {
  for (const row of adjudication.undeclared_findings) {
    if (row.outcome !== 'separate-defect-confound') continue;
    assert.ok(row.remedy, `${row.case_id} is confounded with no remedy`);
    assert.ok(row.remedy.length > 40);
  }
});

test('a single engine is never enough to conclude something about a pair', () => {
  // One engine mapping a rule to an extra criterion is that engine's choice,
  // not a demonstrated property of the pair. `intentional-multiple-defects` is
  // exempt: it states what the fixture is for, which engine count cannot
  // establish or refute.
  const derived = ['separate-defect-confound', 'same-defect-other-criterion'];
  for (const row of adjudication.undeclared_findings) {
    if (row.engines_agreeing > 1) continue;
    assert.equal(
      derived.includes(row.outcome),
      false,
      `${row.case_id} ${row.criterion} concluded ${row.outcome} from one engine`,
    );
  }
});

test('the detector finds nothing on a corpus every engine agrees about', () => {
  // A pair where both pages report the same criteria is not confounded.
  const fixture = [...corpus.cases.values()].find((row) => row.mode === 'tp' && row.path.includes('/'));
  const file = fixture.path.split('/').pop();
  const control = [...corpus.cases.values()].find((row) => row.mode === 'safe' && row.path.endsWith(`safe_${file}`));
  if (!control) return;

  const same = (id) => ({
    case_id: id, case_path: 'f.html', status: 'completed', declared_state: 'default',
    state_reached: true, target_observability: 'observed',
    outcomes: [{ criterion: '9.9.9', native_rule_id: 'x', verdict: 'fail', findings: 1, examined_count: 1, evidence: [{ type: 'manual-note', note: 'n' }] }],
  });

  const found = undeclaredFindings(corpus, [resultWith([same(fixture.id), same(control.id)])]);
  assert.equal(
    found.some((row) => row.case_id === fixture.id && row.criterion === '9.9.9'),
    false,
    'a criterion reported on both pages is not an undeclared finding',
  );
});

test('a criterion reported on almost every page is treated as engine noise', () => {
  // One engine reported a target-size failure on 214 of 248 pages. That is its
  // own baseline, not a property of any fixture.
  const cases = [...corpus.cases.values()].filter((row) => ['tp', 'safe'].includes(row.mode));
  const executions = cases.map((row) => ({
    case_id: row.id, case_path: 'f.html', status: 'completed', declared_state: 'default',
    state_reached: true, target_observability: 'observed',
    outcomes: [{ criterion: '2.5.5', native_rule_id: 'noisy', verdict: 'fail', findings: 1, examined_count: 1, evidence: [{ type: 'manual-note', note: 'n' }] }],
  }));
  // Drop the controls so 2.5.5 appears only on broken pages, yet still on most
  // of the corpus: without the noise filter this would look like 100 confounds.
  const brokenOnly = executions.filter((row) => corpus.cases.get(row.case_id).mode === 'tp');
  const found = undeclaredFindings(corpus, [resultWith([...brokenOnly])]);
  assert.equal(found.some((row) => row.criterion === '2.5.5'), false, '2.5.5 must be filtered as noise');
});

test('reconcile surfaces the undeclared backlog alongside the silent one', () => {
  const report = reconcile({ corpus, manifest, adjudication, results: [resultWith([])] });
  assert.ok(Array.isArray(report.undeclared));
  assert.ok(Array.isArray(report.undeclaredAwaiting));
  // With no findings in an empty run, nothing is awaiting.
  assert.equal(report.undeclared.length, 0);
});
