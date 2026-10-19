// Execute every declared state driver against its real fixture.
//
//   node check/verify-state-drivers.mjs
//
// A declared driver nobody runs is worse than no driver: it reads as covered.
// So each `interaction` driver must show its post-condition false before its
// steps and true after. False-before matters as much as true-after -- a
// condition already satisfied at load proves the steps did nothing, which is
// exactly how a driver rots into decoration.
//
// Exits non-zero on any failure, so CI fails rather than reporting coverage
// that does not exist.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { loadDrivers, driveCase } from './drive-state.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const drivers = [...loadDrivers(ROOT).values()];
const interactive = drivers.filter((d) => d.reached === 'interaction');

const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
  : {});

const failures = [];
const trivial = [];

for (const driver of interactive) {
  let outcome;
  try {
    outcome = await driveCase({ browser, root: ROOT, driver });
  } catch (error) {
    failures.push(`${driver.case_id}: ${String(error.message).split('\n')[0].slice(0, 120)}`);
    continue;
  }
  if (!outcome.state_reached) {
    failures.push(`${driver.case_id}: post-condition still false after steps`);
  } else if (outcome.before === true) {
    trivial.push(driver.case_id);
  }
}

await browser.close();

console.log(`  drivers declared        ${drivers.length}`);
console.log(`  interaction drivers     ${interactive.length}`);
console.log(`  reached their state     ${interactive.length - failures.length}`);

if (trivial.length) {
  console.log(`\n  post-condition already true at load (the steps prove nothing): ${trivial.length}`);
  for (const id of trivial) console.log(`    ${id}`);
}
if (failures.length) {
  console.log(`\n  failed: ${failures.length}`);
  for (const f of failures) console.log(`    ${f}`);
}

if (failures.length || trivial.length) process.exit(1);
console.log('\n  every interaction driver moved its page into the declared state.');
