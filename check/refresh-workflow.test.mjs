// The Monday refresh must still ask for review when Actions cannot open a
// pull request, and it must not push anywhere but its own branch.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/refresh-sources.yml'), 'utf8');

test('the refresh is reviewed by the script, not by an action that needs to open the pull request itself', () => {
  assert.doesNotMatch(WORKFLOW, /create-pull-request/);
  assert.match(WORKFLOW, /node refresh-open\.mjs/);
  assert.ok(fs.existsSync(path.join(ROOT, 'refresh-open.mjs')));
  assert.match(WORKFLOW, /issues: write/);
  assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
});

test('the only push is the refresh branch, and the corpus check still has full history', () => {
  const pushes = WORKFLOW.split('\n').filter((line) => line.includes('git push'));
  assert.deepEqual(pushes.map((line) => line.trim()), ['git push --force origin HEAD:refresh/standards-sources']);
  assert.match(WORKFLOW, /fetch-depth: 0/);
});

test('corpus validation clears a sparse checkout before it checks the files out', () => {
  const validate = fs.readFileSync(path.join(ROOT, '.github/workflows/validate.yml'), 'utf8');
  const clear = validate.indexOf('Clear a sparse checkout left on this runner');
  const checkout = validate.indexOf('uses: actions/checkout@v7');
  assert.ok(clear >= 0 && checkout > clear, 'sparse checkout must be cleared before checkout, or tracked files stay missing');
});

test('a clean tree is not committed, and a source that failed closed still stops the job', () => {
  assert.match(WORKFLOW, /git diff --cached --quiet/);
  assert.match(WORKFLOW, /status == '1'/);
  assert.match(WORKFLOW, /A source failed closed/);
});
