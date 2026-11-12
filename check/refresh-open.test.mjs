// The Monday refresh can push its branch. It cannot rely on opening the pull
// request: this organization refuses that to GitHub Actions.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openRefreshReview, pullRequestBlocked } from '../refresh-open.mjs';

const TITLE = 'Refresh standards-derived sources';
const ISSUE = `${TITLE} needs a pull request`;

function fakeGitHub({ pulls = [], issues = [], pullsPostStatus = 201, pullsPostText = '' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, body });
    const reply = (status, value) => ({
      ok: status < 400,
      status,
      text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
    });
    if (init.method === 'GET' && url.includes('/pulls?')) return reply(200, pulls);
    if (init.method === 'GET' && url.includes('/issues?')) return reply(200, issues);
    if (init.method === 'PATCH') return reply(200, { number: pulls[0].number });
    if (init.method === 'POST' && url.endsWith('/pulls')) {
      return reply(pullsPostStatus, pullsPostStatus < 400 ? { number: 40 } : pullsPostText);
    }
    if (init.method === 'POST' && url.endsWith('/comments')) return reply(201, { id: 1 });
    if (init.method === 'POST' && url.endsWith('/issues')) return reply(201, { number: 41 });
    return reply(500, 'unexpected');
  };
  return { fetchImpl, calls };
}

const review = (extra) => openRefreshReview({
  repo: 'cogniumhq/a11y-benchmark',
  base: 'master',
  head: 'refresh/standards-sources',
  title: TITLE,
  body: '# what moved',
  issueTitle: ISSUE,
  token: 't',
  ...extra,
});

test('an open pull request for the branch is updated and no issue is opened', async () => {
  const { fetchImpl, calls } = fakeGitHub({ pulls: [{ number: 12 }] });
  const result = await review({ fetchImpl });
  assert.deepEqual(result, { action: 'updated', number: 12 });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.equal(calls.at(-1).body.body, '# what moved');
});

test('with no pull request, one is opened', async () => {
  const { fetchImpl, calls } = fakeGitHub();
  const result = await review({ fetchImpl });
  assert.deepEqual(result, { action: 'opened', number: 40 });
  assert.deepEqual(calls.at(-1).body, {
    title: TITLE,
    head: 'refresh/standards-sources',
    base: 'master',
    body: '# what moved',
  });
});

test('when the organization refuses the pull request, the report is filed as an issue with the compare link', async () => {
  const text = 'GitHub Actions is not permitted to create or approve pull requests';
  const { fetchImpl, calls } = fakeGitHub({ pullsPostStatus: 403, pullsPostText: text });
  const result = await review({ fetchImpl });
  assert.equal(result.action, 'issue');
  assert.equal(result.number, 41);
  assert.match(result.compare, /compare\/master\.\.\.refresh\/standards-sources\?expand=1/);
  const filed = calls.at(-1).body;
  assert.equal(filed.title, ISSUE);
  assert.match(filed.body, /cannot open this pull request/);
  assert.match(filed.body, /# what moved/);
  assert.match(filed.body, /expand=1/);
});

test('a second week comments on that issue instead of opening another', async () => {
  const text = 'GitHub Actions is not permitted to create or approve pull requests';
  const { fetchImpl, calls } = fakeGitHub({ pullsPostStatus: 403, pullsPostText: text, issues: [{ number: 88, title: ISSUE }] });
  const result = await review({ fetchImpl });
  assert.equal(result.action, 'commented');
  assert.equal(result.number, 88);
  assert.match(result.compare, /compare\/master\.\.\.refresh\/standards-sources\?expand=1/);
  assert.equal(calls.at(-1).url, 'https://api.github.com/repos/cogniumhq/a11y-benchmark/issues/88/comments');
});

test('a different refusal still fails the run', async () => {
  const { fetchImpl } = fakeGitHub({ pullsPostStatus: 403, pullsPostText: 'Resource not accessible by integration' });
  await assert.rejects(review({ fetchImpl }), /403/);
});

test('no token or an empty report fails before any request', async () => {
  const { fetchImpl, calls } = fakeGitHub();
  await assert.rejects(review({ fetchImpl, token: '' }), /no token/);
  await assert.rejects(review({ fetchImpl, body: '  \n' }), /empty report/);
  assert.equal(calls.length, 0);
});

test('the refusal this organization returns is the one the fallback handles', () => {
  assert.equal(pullRequestBlocked(403, 'GitHub Actions is not permitted to create or approve pull requests'), true);
  assert.equal(pullRequestBlocked(409, 'The organization does not allow GitHub Actions to create or approve pull requests'), true);
  assert.equal(pullRequestBlocked(403, 'Resource not accessible by integration'), false);
  assert.equal(pullRequestBlocked(500, 'GitHub Actions is not permitted to create or approve pull requests'), false);
});
