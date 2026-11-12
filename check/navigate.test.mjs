// A navigation that times out once is tried again; nothing else is retried.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { navigateWithRetry } from '../comparison/navigate.mjs';

const timeout = () => Object.assign(new Error('Navigation timeout of 30000 ms exceeded'), { name: 'TimeoutError' });

test('a first timeout is retried and the second try is what counts', async () => {
  let calls = 0;
  const response = await navigateWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw timeout();
    return { status: () => 200 };
  });
  assert.equal(calls, 2);
  assert.equal(response.status(), 200);
});

test('two timeouts in a row are an error, not a silent pass', async () => {
  let calls = 0;
  await assert.rejects(navigateWithRetry(async () => { calls += 1; throw timeout(); }), /Navigation timeout/);
  assert.equal(calls, 2);
});

test('an error that is not a timeout is thrown at once', async () => {
  let calls = 0;
  await assert.rejects(navigateWithRetry(async () => { calls += 1; throw new Error('net::ERR_CONNECTION_REFUSED'); }), /ERR_CONNECTION_REFUSED/);
  assert.equal(calls, 1);
});

test('a page that loads the first time is read once', async () => {
  let calls = 0;
  await navigateWithRetry(async () => { calls += 1; return {}; });
  assert.equal(calls, 1);
});
