// The access family: pages behind a sign-in, and content that arrives after
// load. These tests prove the gates actually gate, that the declared
// credential actually passes them, and that the accounting pairs cannot be
// credited as a pass when the target was never reached.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACCESS_CREDENTIALS, credentialHeaders } from '../access-gate.mjs';
import { startCorpusServer } from '../serve.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const family = JSON.parse(fs.readFileSync(path.join(ROOT, 'access.json'), 'utf8'));
const cases = family.cases;
const byId = (id) => cases.find((testCase) => testCase.id === id);

const server = startCorpusServer({ root: ROOT, host: '127.0.0.1', port: 0 });
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const get = (relativePath, init = {}) => fetch(`${base}/${relativePath}`, { redirect: 'manual', ...init });
const DEFECT = /<div class="btn" onclick="void 0">Search flights<\/div>/;

async function signIn(fields = {}) {
  const { username, password } = ACCESS_CREDENTIALS['access-form-login'];
  return fetch(`${base}/access/auth/form/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, ...fields }).toString(),
  });
}

test('the family is matched pairs with unique ids, and every pair has one defect and one control', () => {
  assert.equal(family.format, 'cognium-a11y-access-cases');
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
  for (const pair of new Set(cases.map((testCase) => testCase.pair))) {
    const rows = cases.filter((testCase) => testCase.pair === pair);
    assert.deepEqual(rows.map(({ mode }) => mode).sort(), ['safe', 'tp'], pair);
  }
  assert.deepEqual([...new Set(cases.map(({ axis }) => axis))].sort(), ['authenticated', 'dynamic']);
});

test('every gated case names a gate and a credential the family publishes', () => {
  const gates = new Set(['http-basic', 'session-cookie', 'form-login', 'soft-wall']);
  for (const testCase of cases.filter((row) => row.path.startsWith('access/auth/'))) {
    assert.ok(gates.has(testCase.access?.gate), `${testCase.id} gate`);
    assert.ok(Object.hasOwn(family.credentials, testCase.access.credential), `${testCase.id} credential`);
  }
  for (const testCase of cases.filter((row) => !row.path.startsWith('access/auth/'))) {
    assert.equal(testCase.access, undefined, `${testCase.id} is not gated and must not claim a gate`);
  }
});

test('the published credentials are the ones the gate accepts', () => {
  assert.deepEqual(family.credentials, JSON.parse(JSON.stringify(ACCESS_CREDENTIALS)));
});

test('basic auth refuses an anonymous request and admits the declared credential', async () => {
  const anonymous = await get('access/auth/basic/broken.html');
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('www-authenticate') ?? '', /^Basic realm=/);
  assert.doesNotMatch(await anonymous.text(), DEFECT);

  const wrong = await get('access/auth/basic/broken.html', {
    headers: { authorization: `Basic ${Buffer.from('benchmark:wrong').toString('base64')}` },
  });
  assert.equal(wrong.status, 401);

  const admitted = await get('access/auth/basic/broken.html', { headers: credentialHeaders('access-basic') });
  assert.equal(admitted.status, 200);
  assert.match(await admitted.text(), DEFECT);
});

test('the session-cookie area refuses a request without the cookie', async () => {
  assert.equal((await get('access/auth/cookie/broken.html')).status, 401);
  const admitted = await get('access/auth/cookie/broken.html', { headers: credentialHeaders('access-session-cookie') });
  assert.equal(admitted.status, 200);
  assert.match(await admitted.text(), DEFECT);
});

test('the form area redirects to sign-in, signs in, keeps the session, and signs out', async () => {
  const anonymous = await get('access/auth/form/broken.html');
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.headers.get('location'), /^\/access\/auth\/form\/login\.html\?next=/);

  const page = await get('access/auth/form/login.html');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /autocomplete="current-password"/);

  const rejected = await signIn({ password: 'wrong' });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get('set-cookie'), null);

  const accepted = await signIn();
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get('location'), '/access/auth/form/index.html');
  const cookie = accepted.headers.get('set-cookie');
  assert.match(cookie, /^a11y_bench_form=signed-in; Path=\/access\/auth\/; HttpOnly; SameSite=Lax$/);

  const session = { cookie: cookie.split(';')[0] };
  const inside = await get('access/auth/form/broken.html', { headers: session });
  assert.equal(inside.status, 200);
  assert.match(await inside.text(), DEFECT);

  const out = await get('access/auth/form/logout', { headers: session });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('sign-in only redirects back inside the gated area', async () => {
  for (const next of ['https://example.invalid/', '//example.invalid/', '/index.html', '/access/auth/../../serve.mjs']) {
    const response = await signIn({ next });
    assert.equal(response.status, 303, next);
    assert.equal(response.headers.get('location'), '/access/auth/form/index.html', next);
  }
  const back = await signIn({ next: '/access/auth/wall/index.html' });
  assert.equal(back.headers.get('location'), '/access/auth/wall/index.html');
});

test('the sign-in endpoint refuses other methods and an oversized body', async () => {
  assert.equal((await get('access/auth/form/login')).status, 405);
  const huge = await fetch(`${base}/access/auth/form/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${'a'.repeat(8192)}`,
  }).catch(() => ({ status: 413 }));
  assert.equal(huge.status, 413);
  assert.equal((await fetch(`${base}/index.html`, { method: 'POST' })).status, 405);
});

test('the soft wall answers 200 with a sign-in page in place of the content', async () => {
  const anonymous = await get('access/auth/wall/broken.html');
  assert.equal(anonymous.status, 200);
  const body = await anonymous.text();
  assert.match(body, /<title>Sign in to continue<\/title>/);
  assert.doesNotMatch(body, DEFECT);

  const admitted = await get('access/auth/wall/broken.html', { headers: credentialHeaders('access-form-login') });
  assert.equal(admitted.status, 200);
  assert.match(await admitted.text(), DEFECT);
});

test('a fetched fragment behind the sign-in is gated too', async () => {
  assert.equal((await get('access/auth/form/_fragment.html')).status, 302);
  const admitted = await get('access/auth/form/_fragment.html', { headers: credentialHeaders('access-form-login') });
  assert.equal(admitted.status, 200);
  assert.match(await admitted.text(), DEFECT);
});

test('a gate cannot be stepped round by path tricks', async () => {
  for (const trick of [
    'access/auth//basic/broken.html',
    'access/auth/basic/./broken.html',
    'access/AUTH/basic/broken.html',
    'access/auth/Basic/broken.html',
    'access/auth/form/../basic/broken.html',
    'access/auth/%62asic/broken.html',
    'access/auth/unknown/broken.html',
  ]) {
    const response = await get(trick);
    assert.notEqual(response.status, 200, trick);
  }
});

test('a defect-carrying page carries the constant defect once its content has arrived', () => {
  for (const testCase of cases.filter(({ mode, min_criteria: min }) => mode === 'tp' && Object.keys(min).length)) {
    const html = fs.readFileSync(path.join(ROOT, testCase.path), 'utf8');
    const fragment = html.match(/fetch\("([^"]+)"\)/)?.[1];
    const delivered = fragment
      ? fs.readFileSync(path.join(ROOT, path.dirname(testCase.path), fragment), 'utf8')
      : html.replace(/\\"/g, '"');
    assert.match(delivered, DEFECT, testCase.id);
    assert.deepEqual(testCase.min_criteria, { '2.1.1': 1, '1.1.1': 1 }, testCase.id);
  }
});

test('the dynamic defects are absent from the markup a visitor is first served', () => {
  for (const id of ['access-fetched_fragment', 'access-authenticated_fetch', 'access-spa_route']) {
    const html = fs.readFileSync(path.join(ROOT, byId(id).path), 'utf8');
    const served = html.replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(served, DEFECT, `${id} must not ship the defect in its served markup`);
  }
});

test('an accounting case cannot be credited as a pass when the target was not reached', () => {
  const accounting = cases.filter((testCase) => testCase.assertion);
  assert.deepEqual(accounting.map(({ id }) => id).sort(), [
    'access-login_wall_unreached',
    'access-login_wall_unreached-control',
    'access-session_lost',
    'access-session_lost-control',
  ]);
  for (const testCase of accounting) {
    const expected = testCase.assertion.expected_execution;
    assert.equal(expected.error.required, expected.error.code !== null, testCase.id);
    if (testCase.mode === 'tp') {
      assert.notEqual(expected.status, 'completed', testCase.id);
      assert.equal(expected.state_reached, false, testCase.id);
      assert.ok(expected.forbidden_verdicts.includes('pass'), testCase.id);
    } else {
      assert.equal(expected.status, 'completed', testCase.id);
      assert.equal(expected.state_reached, true, testCase.id);
    }
  }
  assert.equal(byId('access-login_wall_unreached').assertion.inputs.response_status, 200,
    'the soft wall answers 200, which is exactly why status alone cannot prove the page was reached');
});
