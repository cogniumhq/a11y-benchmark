// What a new lane snapshot lost, and what it still does not match.
//
//   node gaps.mjs <baseline comparison.json> <candidate comparison.json> \
//        [--tools cognium,axe] [--md report.md] [--json report.json]
//   node gaps.mjs <baseline comparison.json> --cognium-export <export.json> \
//        [--md report.md] [--json report.json]
//
// A regression is a known defect that lost a declared criterion it matched in
// the baseline, or a corrected control that gained one. An execution error that
// the baseline did not have is a regression too. Unmatched declared criteria
// that were already unmatched are standing misses: they are listed, and they
// do not fail the run. The process exits 1 when any tool regressed.
//
// `--cognium-export` scores a sanitized Conformis export against the baseline
// snapshot's own case list, so the private scan does not have to re-run the
// six public tools. The export carries found criteria; the baseline carries
// what each case declares.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { diffTool, laneMetrics } from './diff.mjs';
import { laneOfDocument } from './lanes.mjs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const lost = (before, after) => before.filter((criterion) => !after.includes(criterion));
const gained = (before, after) => after.filter((criterion) => !before.includes(criterion));

export function classifyTool(result) {
  const regressions = [];
  const falsePositives = [];
  for (const difference of result.differences) {
    const dropped = lost(difference.before.matched, difference.after.matched);
    const added = gained(difference.before.matched, difference.after.matched);
    if (difference.mode === 'tp' && (dropped.length > 0 || (difference.before.cell !== 'E' && difference.after.cell === 'E'))) {
      regressions.push({ ...difference, lost: dropped });
    }
    if (difference.mode === 'safe' && (added.length > 0 || (difference.before.cell !== 'E' && difference.after.cell === 'E'))) {
      falsePositives.push({ ...difference, gained: added });
    }
  }
  for (const id of result.missing_in_candidate) {
    regressions.push({ id, mode: 'missing', expected: [], before: { cell: '?', matched: [], rules: [] }, after: { cell: 'missing', matched: [], rules: [] }, lost: [] });
  }
  return { regressions, falsePositives };
}

/** Candidate rows for one tool, joined to the baseline case list. */
export function rowsFromCogniumExport(exported, baselineCases) {
  const byId = new Map(exported.cases.map((row) => [row.id, row]));
  return baselineCases.map((base) => {
    const found = byId.get(base.id);
    const foundCriteria = new Set(found?.found_criteria || []);
    const matched = (base.expected_criteria || []).filter((criterion) => foundCriteria.has(criterion));
    return {
      id: base.id,
      mode: base.mode,
      path: base.path,
      expected_criteria: base.expected_criteria || [],
      status: found ? 'ok' : 'error',
      automated_findings: found?.automated_findings || 0,
      matched_expected_criteria: matched,
      findings: found?.findings || [],
    };
  });
}

export function standingMisses(rows) {
  const byCriterion = new Map();
  let cases = 0;
  for (const row of rows) {
    if (row.mode !== 'tp' || row.status !== 'ok') continue;
    const matched = new Set(row.matched_expected_criteria || []);
    const missed = (row.expected_criteria || []).filter((criterion) => !matched.has(criterion));
    if (!missed.length) continue;
    if (matched.size === 0) cases += 1;
    for (const criterion of missed) {
      const ids = byCriterion.get(criterion) || [];
      ids.push(row.id);
      byCriterion.set(criterion, ids);
    }
  }
  return {
    completeMisses: cases,
    criteria: [...byCriterion.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])),
  };
}

function fmt(difference) {
  const before = `${difference.before.cell}{${difference.before.matched.join(',')}}`;
  const after = `${difference.after.cell}{${difference.after.matched.join(',')}}`;
  const rules = `${difference.before.rules.join(' ') || '-'} -> ${difference.after.rules.join(' ') || '-'}`;
  return `${difference.id} [${difference.mode}; ${(difference.expected || []).join(',')}] ${before} -> ${after}  rules ${rules}`;
}

export function renderReport(report) {
  const lines = ['# Lane gaps', ''];
  lines.push('A regression fails this run. A standing miss was already unmatched in the baseline; it is listed and does not, by itself, fail the run.');
  lines.push('');
  for (const tool of report.tools) {
    const b = tool.baseline;
    const c = tool.candidate;
    lines.push(`## ${tool.label}`);
    lines.push('');
    lines.push(`- Known defects target-detected: ${b.defect_cases_target_detected}/${b.defect_cases} -> ${c.defect_cases_target_detected}/${c.defect_cases}`);
    lines.push(`- Declared criteria matched: ${b.expected_criteria_matched}/${b.expected_criteria} -> ${c.expected_criteria_matched}/${c.expected_criteria}`);
    lines.push(`- Corrected controls target-clean: ${b.controls_target_clean}/${b.control_cases} -> ${c.controls_target_clean}/${c.control_cases}`);
    lines.push(`- Errors: ${b.errors} -> ${c.errors}`);
    lines.push('');
    lines.push(`### Regressions (${tool.regressions.length})`);
    lines.push('');
    if (!tool.regressions.length) lines.push('None.');
    for (const difference of tool.regressions) lines.push(`- ${fmt(difference)}`);
    lines.push('');
    lines.push(`### New false positives (${tool.falsePositives.length})`);
    lines.push('');
    if (!tool.falsePositives.length) lines.push('None.');
    for (const difference of tool.falsePositives) lines.push(`- ${fmt(difference)}`);
    lines.push('');
    lines.push(`### Standing misses (${tool.standing.completeMisses} known-defect cases still match nothing)`);
    lines.push('');
    if (!tool.standing.criteria.length) lines.push('None.');
    for (const [criterion, ids] of tool.standing.criteria) {
      lines.push(`- ${criterion} (${ids.length}): ${ids.join(', ')}`);
    }
    lines.push('');
  }
  lines.push(report.fail
    ? 'Result: regression. A declared criterion was lost, a corrected control was newly flagged, or a case errored.'
    : 'Result: no regression against the baseline.');
  lines.push('');
  return lines.join('\n');
}

export function reportFromSnapshots(baseline, candidate, { tools = null, cogniumExport = null } = {}) {
  assert.equal(baseline.corpus.revision, candidate?.corpus?.revision ?? baseline.corpus.revision, 'different corpus revisions: not comparable');
  if (candidate) assert.equal(baseline.corpus.manifest_sha256, candidate.corpus.manifest_sha256, 'different corpus manifests: not comparable');
  if (candidate) {
    const lanes = [laneOfDocument(baseline), laneOfDocument(candidate)];
    assert.equal(lanes[0], lanes[1], `lane ${lanes[0]} against lane ${lanes[1]}`);
  }
  const ids = tools || (candidate
    ? baseline.tool_order.filter((id) => candidate.tools[id])
    : ['cognium']);
  const toolReports = ids.map((id) => {
    assert.ok(baseline.tools[id], `baseline has no ${id}`);
    const baseRows = baseline.tools[id].cases;
    const candRows = cogniumExport && id === 'cognium'
      ? rowsFromCogniumExport(cogniumExport, baseRows)
      : candidate.tools[id].cases;
    const diff = diffTool(baseRows, candRows);
    const classified = classifyTool(diff);
    return {
      id,
      label: baseline.tools[id].label,
      baseline: diff.baseline,
      candidate: laneMetrics(candRows),
      ...classified,
      standing: standingMisses(candRows),
    };
  });
  const fail = toolReports.some((tool) => tool.regressions.length > 0 || tool.falsePositives.length > 0);
  return { fail, tools: toolReports };
}

function main() {
  const files = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && !['--tools', '--md', '--json', '--cognium-export'].includes(all[index - 1]));
  if (files.length < 1) {
    console.error('usage: node gaps.mjs <baseline comparison.json> [<candidate comparison.json>] [--cognium-export <export.json>] [--tools a,b] [--md report.md] [--json report.json]');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(path.resolve(files[0]), 'utf8'));
  const exportPath = option('cognium-export');
  const candidate = exportPath ? null : JSON.parse(fs.readFileSync(path.resolve(files[1]), 'utf8'));
  if (!exportPath && !files[1]) {
    console.error('a candidate comparison.json or --cognium-export is required');
    process.exit(2);
  }
  const report = reportFromSnapshots(baseline, candidate, {
    tools: option('tools') ? option('tools').split(',') : null,
    cogniumExport: exportPath ? JSON.parse(fs.readFileSync(path.resolve(exportPath), 'utf8')) : null,
  });
  const markdown = renderReport(report);
  process.stdout.write(markdown);
  if (option('md')) fs.writeFileSync(path.resolve(option('md')), markdown);
  if (option('json')) fs.writeFileSync(path.resolve(option('json')), `${JSON.stringify(report, null, 2)}\n`);
  if (report.fail) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
