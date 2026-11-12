// The weekly job runs on a self-hosted runner that has Node and git and nothing
// else. A step that calls a tool the runner lacks only fails when it is reached,
// which for the filing step is the one week a regression needs reporting.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/benchmark-weekly.yml'), 'utf8');

// What grace provides, from the steps that have run there: the shell, git, node and npm, curl.
const ABSENT_ON_RUNNER = ['gh'];

const commands = WORKFLOW.split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .map((line) => line.trim());

test('no step of the weekly job calls a tool the self-hosted runner does not have', () => {
  for (const tool of ABSENT_ON_RUNNER) {
    const calls = commands.filter((line) => new RegExp(`(^|[\\s$(;|&])${tool}\\s+[a-z]`).test(line) && !line.startsWith('- name') && !line.startsWith('uses:'));
    assert.deepEqual(calls, [], `the weekly job calls \`${tool}\`, which is not installed on the runner`);
  }
});

test('the regression is filed by the script that the tests hold, with the job token', () => {
  assert.match(WORKFLOW, /node comparison\/file-issue\.mjs/);
  assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(WORKFLOW, /issues: write/);
  assert.ok(fs.existsSync(path.join(ROOT, 'comparison/file-issue.mjs')));
});

test('filing runs only when the gap check failed, and the report is uploaded either way', () => {
  assert.match(WORKFLOW, /if: failure\(\) && steps\.gaps\.outputs\.fail == 'true'/);
  assert.match(WORKFLOW, /uses: actions\/upload-artifact@v4\n\s+if: always\(\)/);
});
