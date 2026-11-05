// The pure part of run.mjs: rows, lane metrics, the Cognium import and the snapshot.
//
// Moved out of run.mjs unchanged so that it can be tested without the comparison
// tool tree installed. check/comparison-lanes.test.mjs holds it to a snapshot the
// runner wrote before lane variants existed, byte for byte, for the default lane.
// A variant adds one `lane` block and nothing else; the default lane carries none.

import assert from 'node:assert/strict';

import { isVariant, laneBlock, laneOfDocument } from './lanes.mjs';

export function expectedCriteria(testCase) {
  return testCase.mode === 'tp'
    ? Object.keys(testCase.min_criteria || {})
    : [...(testCase.must_not_report || [])];
}

export function rowFor(testCase, started, findings, manualCount = 0, extra = {}) {
  const foundCriteria = [...new Set(findings.flatMap((finding) => finding.criteria))].sort();
  const expected = expectedCriteria(testCase);
  const matchedExpected = expected.filter((criterion) => foundCriteria.includes(criterion));
  return {
    id: testCase.id,
    mode: testCase.mode,
    path: testCase.path,
    expected_criteria: expected,
    status: 'ok',
    automated_findings: findings.reduce((sum, finding) => sum + finding.count, 0),
    manual_review_items: manualCount,
    found_criteria: foundCriteria,
    matched_expected_criteria: matchedExpected,
    findings,
    duration_ms: Date.now() - started,
    ...extra,
  };
}

/**
 * Rows from a sanitized Cognium export (import-cognium.mjs or import-cognium-journeys.mjs).
 *
 * An export made in one lane is refused in a run of another: a variant's rows never
 * become rows of the lane it varies, and the other way round.
 */
export function cogniumRows(exported, cases, { suiteName, corpusRevision, laneName }) {
  assert.equal(exported.schema_version, 2);
  assert.equal(laneOfDocument(exported), laneName,
    `Cognium export is lane ${laneOfDocument(exported)}, this run is lane ${laneName}: a variant is never pooled with another lane`);
  assert.equal(exported.suite, suiteName, 'Cognium export was made for another suite');
  assert.equal(exported.fixture?.commit, corpusRevision, 'Cognium export was made against another corpus revision');
  assert.equal(exported.capture?.capture_misses, 0, 'Cognium export has incomplete capture dependencies');
  assert.equal(exported.capture?.run_errors, 0, 'Cognium export has run errors');
  assert.equal(exported.capture?.outside_the_proofgraph ?? 0, 0, 'Cognium export has records outside the proofgraph');
  const rowById = new Map(exported.cases.map((row) => [row.id, row]));
  const rows = cases.map((testCase) => {
    const source = rowById.get(testCase.id);
    assert.ok(source, `Cognium export has no row for ${testCase.id}`);
    assert.equal(source.path, testCase.path, `Cognium path differs for ${testCase.id}`);
    const row = rowFor(testCase, Date.now(), source.findings, source.manual_review_items, {
      duration_ms: null,
      imported: true,
      source_output_sha256: exported.source_artifact_sha256,
      ...(source.attribution ? { attribution: source.attribution } : {}),
    });
    assert.deepEqual(row.found_criteria, source.found_criteria);
    return row;
  });
  return { rows, exported };
}

export function summarize(rows) {
  const successful = rows.filter((row) => row.status === 'ok');
  const tp = successful.filter((row) => row.mode === 'tp');
  const safe = successful.filter((row) => row.mode === 'safe');
  return {
    cases: rows.length,
    errors: rows.filter((row) => row.status === 'error').length,
    tp_cases: tp.length,
    tp_pages_with_target_findings: tp.filter((row) => row.matched_expected_criteria.length > 0).length,
    tp_pages_with_other_findings_only: tp.filter((row) =>
      row.automated_findings > 0 && row.matched_expected_criteria.length === 0).length,
    safe_cases: safe.length,
    safe_pages_without_target_findings: safe.filter((row) => row.matched_expected_criteria.length === 0).length,
    safe_pages_with_target_findings: safe.filter((row) => row.matched_expected_criteria.length > 0).length,
    safe_pages_with_other_findings_only: safe.filter((row) =>
      row.automated_findings > 0 && row.matched_expected_criteria.length === 0).length,
    expected_criteria: tp.reduce((sum, row) => sum + row.expected_criteria.length, 0),
    expected_criteria_matched: tp.reduce((sum, row) => sum + row.matched_expected_criteria.length, 0),
    manual_review_items: successful.reduce((sum, row) => sum + row.manual_review_items, 0),
    duration_ms: successful.reduce((sum, row) => sum + (row.duration_ms || 0), 0),
  };
}

/** One tool's entry in the snapshot. */
export function toolEntry({ id, label, version, result, startedAt, completedAt, ibmEngine = null, lineage }) {
  const rows = id === 'cognium' ? result.rows : result;
  return {
    label,
    version: id === 'cognium' ? result.exported.version : version,
    source: id === 'cognium' ? {
      kind: 'sanitized-import',
      generated: result.exported.generated,
      view: result.exported.source_view,
      capture: result.exported.capture,
      environment: result.exported.environment,
      versions: result.exported.versions,
      ...(result.exported.conformis ? { conformis: result.exported.conformis } : {}),
      ...(result.exported.explore ? { explore: result.exported.explore } : {}),
      ...(result.exported.subjects ? { subjects: result.exported.subjects } : {}),
    } : {
      kind: 'live-local-scan',
      ...(id === 'ibm' ? { rule_engine: ibmEngine } : {}),
    },
    run: id === 'cognium' && result.exported.run
      ? result.exported.run
      : { started_at: startedAt, completed_at: completedAt, repeat: 1 },
    lineage,
    summary: summarize(rows),
    traceability: null,
    cases: rows,
  };
}

/** The snapshot run.mjs writes. A variant lane adds its `lane` block after `suite`. */
export function buildSnapshot({
  laneName, generated, suite, corpus, coverage, environment, runner, toolIds, selectedCases, tools,
}) {
  return {
    schema_version: 1,
    generated,
    suite: { name: suite.name, description: suite.description, has_scenario_traceability: false },
    ...(isVariant(laneName) ? { lane: laneBlock(laneName) } : {}),
    corpus,
    coverage,
    environment,
    runner,
    privacy: {
      target: 'ephemeral localhost server only',
      hosted_services: false,
      repository_content_uploaded: false,
      install_scripts_disabled_by_npmrc: true,
      ibm_scan_metrics_suppressed: true,
      ibm_rules_served_locally: true,
      cognium_export_contains_raw_evidence: false,
    },
    tool_order: toolIds,
    cases: selectedCases.map((testCase) => ({
      id: testCase.id, mode: testCase.mode, path: testCase.path, expected_criteria: expectedCriteria(testCase),
    })),
    tools,
  };
}
