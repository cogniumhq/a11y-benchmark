// Merge comparison snapshots taken separately for the same lane into one.
//
//   node merge.mjs --out <comparison.json> <snapshot.json> [<snapshot.json> ...]
//
// Typically the Cognium Conformis import and the six direct tools are run as two
// invocations of run.mjs. This joins them in the order given. It refuses snapshots
// that differ in corpus revision, manifest, suite, case list or runner pins, and a
// tool that appears twice. The top-level environment is that of the first snapshot
// that ran a tool live; an imported tool keeps its own environment in its source.
// It refuses snapshots of two lanes (lanes.mjs): a variant is published apart and
// its rows never join the lane it varies.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { assertOneLane } from './lanes.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
assert.ok(outIndex >= 0 && args[outIndex + 1], 'usage: node merge.mjs --out <comparison.json> <snapshot.json> ...');
const out = path.resolve(args[outIndex + 1]);
const inputs = args.filter((_, index) => index !== outIndex && index !== outIndex + 1);
assert.ok(inputs.length >= 2, 'give at least two snapshots');

const snapshots = inputs.map((file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
const [first] = snapshots;
assertOneLane(snapshots, inputs);
const sameAs = (key, value) => snapshots.forEach((snapshot, index) =>
  assert.deepEqual(value(snapshot), value(first), `${inputs[index]} differs in ${key}`));
sameAs('corpus', (s) => s.corpus);
sameAs('suite', (s) => s.suite.name);
sameAs('cases', (s) => s.cases);
sameAs('runner pins', (s) => [s.runner?.pins_sha256, s.runner?.package_lock_sha256]);

const live = snapshots.find((s) => Object.values(s.tools).some((tool) => tool.source?.kind === 'live-local-scan')) ?? first;
const tools = {};
const toolOrder = [];
for (const snapshot of snapshots) {
  for (const id of snapshot.tool_order) {
    assert.equal(id in tools, false, `tool ${id} appears in more than one snapshot`);
    tools[id] = snapshot.tools[id];
    toolOrder.push(id);
  }
}

const merged = {
  ...live,
  generated: snapshots.map((s) => s.generated).sort().at(-1),
  runner: {
    ...live.runner,
    unpinned: [...new Set(snapshots.flatMap((s) => s.runner?.unpinned ?? []))],
    merged_from: snapshots.map((s) => ({ generated: s.generated, revision: s.runner?.revision ?? null, tools: s.tool_order })),
  },
  tool_order: toolOrder,
  tools,
};
fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`wrote ${out}: ${toolOrder.join(', ')}`);
