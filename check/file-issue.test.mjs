// Filing the weekly regression needs nothing installed on the runner, and never
// files the same title twice.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileIssue, findOpenIssue } from '../comparison/file-issue.mjs';

const TITLE = 'Weekly benchmark: regression against the published lane';

function fakeGitHub(openIssues) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
    const reply = (status, value) => ({ ok: status < 400, status, json: async () => value, text: async () => JSON.stringify(value) });
    if (init.method === 'GET') return reply(200, openIssues);
    if (url.endsWith('/comments')) return reply(201, { id: 1 });
    return reply(201, { number: 900 });
  };
  return { fetchImpl, calls };
}

test('with no open issue of that title, one is opened', async () => {
  const { fetchImpl, calls } = fakeGitHub([{ number: 5, title: 'something else' }]);
  const result = await fileIssue({ repo: 'o/r', title: TITLE, body: '# Lane gaps', token: 't', fetchImpl });
  assert.deepEqual(result, { action: 'created', number: 900 });
  assert.equal(calls.at(-1).url, 'https://api.github.com/repos/o/r/issues');
  assert.deepEqual(calls.at(-1).body, { title: TITLE, body: '# Lane gaps' });
  assert.equal(calls.at(-1).auth, 'Bearer t');
});

test('an open issue of that exact title gets a comment, not a second issue', async () => {
  const { fetchImpl, calls } = fakeGitHub([{ number: 7, title: TITLE }]);
  const result = await fileIssue({ repo: 'o/r', title: TITLE, body: '# Lane gaps', token: 't', fetchImpl });
  assert.deepEqual(result, { action: 'commented', number: 7 });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls.at(-1).url, 'https://api.github.com/repos/o/r/issues/7/comments');
});

test('a pull request with the same title is not the issue, and a longer title is not a match', async () => {
  const items = [{ number: 3, title: TITLE, pull_request: {} }, { number: 4, title: `${TITLE} (old)` }];
  assert.equal(await findOpenIssue({ repo: 'o/r', title: TITLE, token: 't', fetchImpl: fakeGitHub(items).fetchImpl }), null);
});

test('no token or an empty report fails loudly instead of filing nothing', async () => {
  const { fetchImpl } = fakeGitHub([]);
  await assert.rejects(fileIssue({ repo: 'o/r', title: TITLE, body: 'x', token: '', fetchImpl }), /no token/);
  await assert.rejects(fileIssue({ repo: 'o/r', title: TITLE, body: '  \n', token: 't', fetchImpl }), /empty report/);
});

test('an API refusal is an error with the status, so the step fails and says why', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'Resource not accessible by integration' });
  await assert.rejects(fileIssue({ repo: 'o/r', title: TITLE, body: 'x', token: 't', fetchImpl }), /403/);
});
