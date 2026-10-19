// The state-driver contract: every case that claims a state or an interaction
// says how to reach it, and the hand-written Playwright cannot drift from it.
//
// These tests do not open a browser. `check/verify-state-drivers.mjs` does
// that, and it is what proves the steps work; these guard the shape, the
// coverage, and the two things most likely to rot quietly — a case added
// without a driver, and the imperative file growing knowledge the contract
// does not have.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { loadCorpus } from './scoring.mjs';
import { needsDriver, hasInteractiveHandlers, imperativelyDrivenPaths } from '../state-drivers.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const drivers = readJson('state-drivers.json');
const corpus = loadCorpus(ROOT);
const byCase = new Map(drivers.drivers.map((driver) => [driver.case_id, driver]));

test('the state-driver file satisfies its schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  const validate = ajv.compile(readJson('schemas/state-drivers.schema.json'));
  assert.ok(validate(drivers), ajv.errorsText(validate.errors));
});

test('every case claiming a state or an interaction has a driver', () => {
  const drivenPaths = imperativelyDrivenPaths(ROOT);
  const missing = [...corpus.cases.values()]
    .filter((fixture) => needsDriver(fixture, drivenPaths))
    .map((fixture) => fixture.id)
    .filter((id) => !byCase.has(id));
  assert.deepEqual(missing, [], 'a case declaring a non-default state must say how to reach it');
});

test('no driver describes a case that is not in the corpus', () => {
  const orphans = drivers.drivers
    .map((driver) => driver.case_id)
    .filter((id) => !corpus.cases.has(id));
  assert.deepEqual(orphans, []);
});

test('a driver points at the path its case actually has', () => {
  for (const driver of drivers.drivers) {
    assert.equal(driver.path, corpus.cases.get(driver.case_id).path, driver.case_id);
    assert.ok(fs.existsSync(path.join(ROOT, driver.path)), `${driver.path} does not exist`);
  }
});

test('a driver records the state its case declares', () => {
  for (const driver of drivers.drivers) {
    const fixture = corpus.cases.get(driver.case_id);
    assert.equal(driver.declared_state, fixture.ui_state ?? 'default', driver.case_id);
  }
});

test('an interaction driver carries steps and a post-condition', () => {
  for (const driver of drivers.drivers.filter((row) => row.reached === 'interaction')) {
    assert.ok(driver.steps?.length > 0, `${driver.case_id} has no steps`);
    assert.ok(driver.post_condition?.kind, `${driver.case_id} has no post-condition`);
  }
});

test('a driver that declares no steps says why', () => {
  // "Nobody wrote a driver" and "no driver is possible" are different facts,
  // and only one of them is a backlog item. An unexplained absence of steps
  // cannot be told apart from an oversight.
  for (const driver of drivers.drivers.filter((row) => row.reached !== 'interaction')) {
    assert.ok(driver.reason && driver.reason.length >= 20, `${driver.case_id} gives no reason`);
  }
});

test('an at-load claim is only made for a page that cannot change state', () => {
  // The claim is "this page renders exactly one state", and what would falsify
  // it is something bound to an event -- not the mere presence of script.
  // `ui-states/safe_error.html` runs one line that focuses an alert at load and
  // binds nothing; it has a script and exactly one state.
  for (const driver of drivers.drivers.filter((row) => row.reached === 'at-load')) {
    const html = fs.readFileSync(path.join(ROOT, driver.path), 'utf8');
    assert.equal(hasInteractiveHandlers(html), false,
      `${driver.case_id} claims at-load but binds an event handler; it may reach another state`);
  }
});

test('a declared-steps driver belongs to a case that really declares steps', () => {
  for (const driver of drivers.drivers.filter((row) => row.reached === 'declared-steps')) {
    const fixture = corpus.cases.get(driver.case_id);
    assert.equal(fixture.scope, 'multi-page', driver.case_id);
    assert.ok((fixture.steps ?? []).length > 0, `${driver.case_id} declares no steps`);
  }
});

test('a post-condition never asserts the criterion the case is about', () => {
  // A driver proves the page reached a state. Whether the state is accessible
  // is the scorer's question. A post-condition demanding `aria-invalid="true"`
  // on a page whose defect is the missing attribute would make a correct
  // fixture undrivable and quietly test for the fix.
  const FIXES = /aria-invalid="true"|aria-busy="true"|aria-disabled="true"|role="alert"/;
  for (const driver of drivers.drivers.filter((row) => row.reached === 'interaction')) {
    const serialised = JSON.stringify(driver.post_condition);
    assert.equal(FIXES.test(serialised), false,
      `${driver.case_id} post-condition asserts a correction, not a state`);
  }
});

test('the hand-written Playwright cannot cover a case the contract does not', () => {
  // The acceptance criterion from #46: the imperative knowledge in
  // scenario-interactions.mjs and the declared knowledge must not drift. Every
  // fixture that file drives has to have a driver here, so the contract can
  // never be the lesser of the two.
  const source = fs.readFileSync(path.join(ROOT, 'check/scenario-interactions.mjs'), 'utf8');
  const driven = [...source.matchAll(/open\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(driven.length > 0, 'expected scenario-interactions.mjs to open fixtures');

  const declared = new Set(drivers.drivers.map((driver) => driver.path));
  const undeclared = [...new Set(driven)].filter((p) => !declared.has(p));
  assert.deepEqual(undeclared, [],
    'scenario-interactions.mjs drives a fixture the state-driver contract does not declare');
});

test('the manifest records the contract and its digest', () => {
  const manifest = readJson('corpus-manifest.json');
  const entry = (manifest.contracts ?? []).find((row) => row.id === 'state-drivers');
  assert.ok(entry, 'corpus-manifest.json must list the state-driver contract');
  assert.equal(entry.file, 'state-drivers.json');
  assert.equal(entry.entry_count, drivers.drivers.length);
  assert.match(entry.content_sha256, /^sha256:[a-f0-9]{64}$/);
});

test('every step names what it needs', () => {
  const NEEDS_SELECTOR = new Set(['click', 'focus', 'fill', 'select', 'hover', 'dispatch']);
  for (const driver of drivers.drivers.filter((row) => row.reached === 'interaction')) {
    for (const step of driver.steps) {
      if (NEEDS_SELECTOR.has(step.action)) {
        assert.ok(step.selector, `${driver.case_id}: ${step.action} without a selector`);
      }
      if (step.action === 'press') assert.ok(step.key, `${driver.case_id}: press without a key`);
      if (step.action === 'dispatch') assert.ok(step.event, `${driver.case_id}: dispatch without an event`);
    }
  }
});

test('steps are declarative, not code', () => {
  // The contract is meant to be executable by a runner that is not this one.
  // A step carrying a script string would make it Playwright's private format
  // again, which is the thing #46 is about.
  const serialised = JSON.stringify(drivers.drivers);
  for (const smell of ['=>', 'function(', 'function (', 'await ', 'page.']) {
    assert.equal(serialised.includes(smell), false, `steps contain code: ${smell}`);
  }
});
