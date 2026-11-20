// The sign-in gates for the access family.
//
// `access/auth/` is the only part of the corpus a visitor cannot simply load.
// Each directory below it is guarded the way real sites are guarded, so a
// scanner is measured on whether it gets past the gate it was given the means
// to pass, and on whether it says so when it did not:
//
//   basic/   HTTP basic auth. Without the header: 401 and a WWW-Authenticate.
//   cookie/  a session cookie the owner hands over. Without it: 401.
//   form/    a form sign-in. Without the session: 302 to the sign-in page.
//            POST form/login sets the session; form/logout ends it.
//   wall/    a soft wall. Without the session the server answers 200 with a
//            sign-in page in place of the content, which is what most
//            single-page applications do, and what a scanner most often
//            mistakes for the page it asked for.
//
// The credentials below are public, synthetic and grant nothing outside this
// corpus. They exist so the gates can be exercised; they are not secrets, and
// a real customer's credentials never belong in this repository.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const ACCESS_CREDENTIALS = Object.freeze({
  'access-basic': Object.freeze({
    kind: 'http-basic',
    username: 'benchmark',
    password: 'public-synthetic-only',
  }),
  'access-session-cookie': Object.freeze({
    kind: 'cookie',
    name: 'a11y_bench_session',
    value: 'public-synthetic-session',
  }),
  'access-form-login': Object.freeze({
    kind: 'form-login',
    username: 'benchmark',
    password: 'public-synthetic-only',
    sign_in_page: 'access/auth/form/login.html',
    action: 'access/auth/form/login',
    method: 'POST',
    fields: Object.freeze({ username: 'username', password: 'password' }),
    session_cookie: 'a11y_bench_form',
  }),
});

const PREFIX = '/access/auth/';
const FORM_COOKIE = 'a11y_bench_form';
const FORM_SESSION = 'signed-in';
const SIGN_IN_PAGE = `${PREFIX}form/login.html`;
const FORM_LANDING = `${PREFIX}form/index.html`;
const WALL_SIGN_IN = 'access/auth/wall/_sign-in.html';
const MAX_BODY = 4096;

const basic = ACCESS_CREDENTIALS['access-basic'];
const BASIC_HEADER = `Basic ${Buffer.from(`${basic.username}:${basic.password}`).toString('base64')}`;
const sessionCookie = ACCESS_CREDENTIALS['access-session-cookie'];

/**
 * The request headers that pass a gate. A harness or a contract test uses
 * this rather than restating the credentials, so the two cannot drift.
 */
export function credentialHeaders(credential) {
  switch (credential) {
    case 'access-basic': return { authorization: BASIC_HEADER };
    case 'access-session-cookie': return { cookie: `${sessionCookie.name}=${sessionCookie.value}` };
    case 'access-form-login': return { cookie: `${FORM_COOKIE}=${FORM_SESSION}` };
    default: return {};
  }
}

function readCookies(req) {
  const jar = new Map();
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

const signedIn = (req) => readCookies(req).get(FORM_COOKIE) === FORM_SESSION;

function html(res, status, title, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`);
}

function redirect(res, status, location, headers = {}) {
  res.writeHead(status, { location, 'cache-control': 'no-store', ...headers });
  res.end();
}

// Only a path back inside the gated area is honoured. Anything else -- another
// origin, a protocol-relative URL, a backslash trick -- lands on the default.
function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return FORM_LANDING;
  if (value.includes('//') || value.includes('\\') || value.includes('..')) return FORM_LANDING;
  return value;
}

function signIn(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    html(res, 405, 'Method not allowed', '<p>Sign in from the sign-in page.</p>');
    return;
  }
  const chunks = [];
  let size = 0;
  let refused = false;
  req.on('data', (chunk) => {
    if (refused) return;
    size += chunk.length;
    if (size > MAX_BODY) {
      refused = true;
      html(res, 413, 'Request too large', '<p>The sign-in form is small; this request was not.</p>');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const expected = ACCESS_CREDENTIALS['access-form-login'];
    if (form.get('username') !== expected.username || form.get('password') !== expected.password) {
      html(res, 401, 'Sign-in not accepted',
        `<p>The email address or password was not recognised. <a href="${SIGN_IN_PAGE}">Try again</a>.</p>`);
      return;
    }
    redirect(res, 303, safeNext(form.get('next')), {
      'set-cookie': `${FORM_COOKIE}=${FORM_SESSION}; Path=${PREFIX}; HttpOnly; SameSite=Lax`,
    });
  });
}

/**
 * Apply the gate for `req`. Returns true when the gate answered the request
 * itself, false when the corpus server should serve the file as usual.
 */
export function accessGate(req, res, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(req.url || '/', 'http://corpus.invalid').pathname);
  } catch {
    return false;
  }
  // Normalised and lower-cased the way the file lookup will see it, so a
  // doubled slash or a case-insensitive filesystem cannot step round a gate.
  const pathname = posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
  if (!pathname.startsWith(PREFIX) && pathname !== PREFIX.slice(0, -1)) return false;
  const area = pathname.slice(PREFIX.length).split('/')[0];

  if (area === 'basic') {
    if (req.headers.authorization === BASIC_HEADER) return false;
    html(res, 401, 'Sign-in required', '<p>This area uses HTTP basic authentication.</p>', {
      'www-authenticate': 'Basic realm="a11y-benchmark synthetic account", charset="UTF-8"',
    });
    return true;
  }

  if (area === 'cookie') {
    if (readCookies(req).get(sessionCookie.name) === sessionCookie.value) return false;
    html(res, 401, 'Session required', '<p>This area needs a session cookie from the site owner.</p>');
    return true;
  }

  if (area === 'form') {
    if (pathname === `${PREFIX}form/login`) { signIn(req, res); return true; }
    if (pathname === SIGN_IN_PAGE) return false;
    if (pathname === `${PREFIX}form/logout`) {
      redirect(res, 303, SIGN_IN_PAGE, {
        'set-cookie': `${FORM_COOKIE}=; Path=${PREFIX}; HttpOnly; SameSite=Lax; Max-Age=0`,
      });
      return true;
    }
    if (signedIn(req)) return false;
    redirect(res, 302, `${SIGN_IN_PAGE}?next=${encodeURIComponent(pathname)}`);
    return true;
  }

  if (area === 'wall') {
    if (signedIn(req)) return false;
    // Deliberately 200. The sign-in page stands in for whatever was asked for.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return true; }
    res.end(readFileSync(join(root, WALL_SIGN_IN)));
    return true;
  }

  // Nothing else lives under access/auth/. Refusing it here, rather than
  // falling through to the file server, keeps a new directory from being
  // served ungated by accident.
  html(res, 404, 'Not found', '<p>There is no such gated area.</p>');
  return true;
}
