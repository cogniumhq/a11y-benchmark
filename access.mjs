// Access family: content a scanner has to get to before it can judge it.
//
// Two questions a buyer asks about any automated checker, made measurable:
//
//   1. Authenticated sites. Can it test pages behind a sign-in, and when it
//      cannot, does it say so rather than pass the sign-in page in their place?
//   2. Dynamically loaded content. Does it see what arrives after load --
//      fetched over the network, rendered by a client-side route, or on a page
//      that never stops changing?
//
// `delivery.mjs` already covers content injected by script, iframes and shadow
// roots. This family does not repeat those rows. It adds the network, the
// router and the clock, and it adds the gate.
//
// Every page that carries a defect carries the same two as `delivery.mjs`:
//
//   2.1.1  a <div> styled as a button, no tabindex, no role, no key handler
//   1.1.1  an <img> with no alt, no aria-label, no decorative declaration
//
// and every safe control renders the corrected pair at the same spot. Holding
// the defect constant means a scanner that reports both on the open page and
// neither behind the gate has an access gap, not a rule gap.
//
// The gates themselves are in `access-gate.mjs`, which `serve.mjs` applies. A
// gated fixture only exists as a gated fixture when it is served; read from
// disk, it is an ordinary page, and that is not what these cases measure.

import fs from 'node:fs';
import path from 'node:path';

import { ACCESS_CREDENTIALS } from './access-gate.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(ROOT, 'access');

const depthOf = (relativePath) => path.posix.dirname(path.posix.join('access', relativePath)).split('/').length;
const up = (relativePath) => '../'.repeat(depthOf(relativePath));

const broken = (relativePath) => `<div class="btn" onclick="void 0">Search flights</div>
<img src="${up(relativePath)}pixel.png">`;
const corrected = (relativePath) => `<button type="button">Search flights</button>
<img src="${up(relativePath)}pixel.png" alt="Airline logo">`;

const page = (relativePath, title, body, head = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${up(relativePath)}fixture.css">${head}
</head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>`;

const write = (relativePath, contents) => {
  const destination = path.join(DIR, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
};

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

// --- authenticated pages ----------------------------------------------------

const account = (relativePath, variant, gateName) => page(relativePath,
  variant === 'broken' ? `Your trips (${gateName})` : `Your trips (${gateName}, corrected)`,
  `<p>Signed-in content. A scanner that reports on this page reached it.</p>
${variant === 'broken' ? broken(relativePath) : corrected(relativePath)}`);

for (const variant of ['broken', 'safe']) {
  write(`auth/basic/${variant}.html`, account(`auth/basic/${variant}.html`, variant, 'basic auth'));
  write(`auth/cookie/${variant}.html`, account(`auth/cookie/${variant}.html`, variant, 'session cookie'));
  write(`auth/form/${variant}.html`, account(`auth/form/${variant}.html`, variant, 'form sign-in'));
  write(`auth/wall/${variant}.html`, account(`auth/wall/${variant}.html`, variant, 'behind a sign-in wall'));
}

const form = ACCESS_CREDENTIALS['access-form-login'];
const signInForm = (relativePath, title, next = '') => page(relativePath, title,
  `<p>Sign in with the public benchmark account. The details are published in
<code>access.json</code> and grant nothing outside this corpus.</p>
<form method="post" action="/${form.action}">
${next ? `<input type="hidden" name="next" value="${next}">\n` : ''}<p><label for="username">Email address or username</label>
<input id="username" name="${form.fields.username}" autocomplete="username" required></p>
<p><label for="password">Password</label>
<input id="password" name="${form.fields.password}" type="password" autocomplete="current-password" required></p>
<p><button type="submit">Sign in</button></p>
</form>`);

write('auth/form/login.html', signInForm('auth/form/login.html', 'Sign in'));
write('auth/wall/_sign-in.html', signInForm('auth/wall/_sign-in.html', 'Sign in to continue', '/access/auth/wall/index.html'));

write('auth/form/index.html', page('auth/form/index.html', 'Account home',
  `<p>You are signed in.</p>
<ul>
<li><a href="logout">Sign out</a></li>
<li><a href="orders.html">Your orders</a></li>
<li><a href="broken.html">Your trips</a></li>
<li><a href="safe.html">Your trips (corrected)</a></li>
<li><a href="dynamic.html">Recent activity</a></li>
<li><a href="safe_dynamic.html">Recent activity (corrected)</a></li>
</ul>`));
write('auth/form/orders.html', page('auth/form/orders.html', 'Your orders',
  '<p>No orders yet. <a href="index.html">Back to account home</a>.</p>'));
write('auth/wall/index.html', page('auth/wall/index.html', 'Saved trips',
  '<ul><li><a href="broken.html">Your trips</a></li><li><a href="safe.html">Your trips (corrected)</a></li></ul>'));

// Content fetched after load, behind the same sign-in. The fragment is gated
// too, so a runner whose fetch does not carry the session gets the redirect.
const fetched = (relativePath, title, fragment) => page(relativePath, title,
  `<div id="activity"><p>Loading recent activity…</p></div>`,
  `\n<script>addEventListener('load',()=>{fetch(${JSON.stringify(fragment)}).then((r)=>r.text()).then((t)=>{document.getElementById('activity').innerHTML=t;});});</script>`);

write('auth/form/dynamic.html', fetched('auth/form/dynamic.html', 'Recent activity', '_fragment.html'));
write('auth/form/safe_dynamic.html', fetched('auth/form/safe_dynamic.html', 'Recent activity (corrected)', '_safe_fragment.html'));
write('auth/form/_fragment.html', `${broken('auth/form/_fragment.html')}\n`);
write('auth/form/_safe_fragment.html', `${corrected('auth/form/_safe_fragment.html')}\n`);

// --- dynamically loaded pages -----------------------------------------------

write('dynamic/fetched.html', fetched('dynamic/fetched.html', 'Fares fetched after load', '_fragment.html'));
write('dynamic/safe_fetched.html', fetched('dynamic/safe_fetched.html', 'Fares fetched after load (corrected)', '_safe_fragment.html'));
write('dynamic/_fragment.html', `${broken('dynamic/_fragment.html')}\n`);
write('dynamic/_safe_fragment.html', `${corrected('dynamic/_safe_fragment.html')}\n`);

// A client-side route. The Settings view exists only after the router renders
// it, and its URL does not serve it: reloading `?route=/settings` comes back
// to Trips. Reaching it takes a click, and nothing a crawler collects will do.
const spa = (relativePath, title, settings) => page(relativePath, title,
  `<nav aria-label="Account"><a href="#/trips" id="nav-trips">Trips</a> <a href="#/settings" id="nav-settings">Settings</a></nav>
<div id="view"><h2>Your trips</h2><p>No upcoming trips.</p></div>`,
  `\n<script>
const views = {
  '/trips': '<h2>Your trips</h2><p>No upcoming trips.</p>',
  '/settings': ${JSON.stringify(`<h2 id="view-settings">Settings</h2>${settings}`)},
};
addEventListener('DOMContentLoaded', () => {
  for (const link of document.querySelectorAll('nav a')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const route = link.getAttribute('href').slice(1);
      history.pushState({ route }, '', '?route=' + route);
      document.getElementById('view').innerHTML = views[route] ?? views['/trips'];
    });
  }
});
</script>`);

write('dynamic/spa_route.html', spa('dynamic/spa_route.html', 'Account (client-side routes)', broken('dynamic/spa_route.html')));
write('dynamic/safe_spa_route.html', spa('dynamic/safe_spa_route.html', 'Account (client-side routes, corrected)', corrected('dynamic/safe_spa_route.html')));

// A page that never goes quiet. The defect is there at load; what is tested is
// whether a runner that waits for the DOM to settle ever reports at all.
const neverIdle = (relativePath, title, body) => page(relativePath, title,
  `<p>Departures board. Updated continuously.</p>
<p>Last update: <span id="clock">—</span></p>
${body}`,
  `\n<script>addEventListener('DOMContentLoaded',()=>{const c=document.getElementById('clock');setInterval(()=>{c.textContent=String(Date.now());},200);});</script>`);

write('dynamic/never_idle.html', neverIdle('dynamic/never_idle.html', 'Departures that never settle', broken('dynamic/never_idle.html')));
write('dynamic/safe_never_idle.html', neverIdle('dynamic/safe_never_idle.html', 'Departures that never settle (corrected)', corrected('dynamic/safe_never_idle.html')));

// --- cases --------------------------------------------------------------------

const CONSTANT = { '2.1.1': 1, '1.1.1': 1 };
const REPORTED = ['1.1.1', '2.1.1'];
const base = { surface: 'web', ui_state: 'default', input_at: ['keyboard'] };

const gates = {
  'http-basic': { gate: 'http-basic', credential: 'access-basic' },
  'session-cookie': { gate: 'session-cookie', credential: 'access-session-cookie' },
  'form-login': { gate: 'form-login', credential: 'access-form-login' },
  'soft-wall': { gate: 'soft-wall', credential: 'access-form-login' },
};

const pair = (slug, { axis, journey, method, tpPath, safePath, access, notes, safeNotes, extra = {} }) => [
  {
    ...base, id: `access-${slug}`, pair: slug, mode: 'tp', axis, journey, scope: 'single-page',
    method, path: `access/${tpPath}`, ...(access ? { access } : {}), ...extra,
    min_criteria: CONSTANT, must_not_report: [], notes,
  },
  {
    ...base, id: `access-safe_${slug}`, pair: slug, mode: 'safe', axis, journey, scope: 'single-page',
    method, path: `access/${safePath}`, ...(access ? { access } : {}), ...extra,
    min_criteria: {}, must_not_report: REPORTED, notes: safeNotes,
  },
];

const expectation = ({ status, declaredState, stateReached, observability, examined, errorCode = null, forbidPass = false }) => ({
  status,
  declared_state: declaredState,
  state_reached: stateReached,
  target_observability: observability,
  examined_count: examined,
  error: { required: errorCode !== null, code: errorCode },
  forbidden_verdicts: forbidPass ? ['pass'] : [],
});

const accounting = (slug, { tp, control }) => [
  {
    ...base, id: `access-${slug}`, pair: slug, mode: 'tp', axis: 'authenticated', scope: 'single-page',
    journey: 'session', method: ['crawl', 'regression'],
    min_criteria: {}, must_not_report: [], ...tp,
  },
  {
    ...base, id: `access-${slug}-control`, pair: slug, mode: 'safe', axis: 'authenticated', scope: 'single-page',
    journey: 'session', method: ['crawl', 'regression'],
    min_criteria: {}, must_not_report: [], ...control,
  },
];

const cases = [
  ...pair('basic_auth', {
    axis: 'authenticated', journey: 'session', method: ['crawl', 'runtime-dom'],
    tpPath: 'auth/basic/broken.html', safePath: 'auth/basic/safe.html', access: gates['http-basic'],
    notes: 'Behind HTTP basic auth. Unauthenticated, the server answers 401. Given the declared credential, '
      + 'a scanner must reach the page and report both constant defects.',
    safeNotes: 'Corrected control behind the same basic-auth gate. Reporting 2.1.1 or 1.1.1 here is a false positive.',
  }),
  ...pair('session_cookie', {
    axis: 'authenticated', journey: 'session', method: ['crawl', 'runtime-dom'],
    tpPath: 'auth/cookie/broken.html', safePath: 'auth/cookie/safe.html', access: gates['session-cookie'],
    notes: 'Behind a session cookie the site owner hands over. Without it the server answers 401.',
    safeNotes: 'Corrected control behind the same session cookie.',
  }),
  ...pair('form_login', {
    axis: 'authenticated', journey: 'auth-signup', method: ['crawl', 'runtime-dom'],
    tpPath: 'auth/form/broken.html', safePath: 'auth/form/safe.html',
    access: { ...gates['form-login'], sign_in_page: form.sign_in_page },
    notes: 'Behind a form sign-in. Unauthenticated requests redirect to the sign-in page. A scanner '
      + 'must sign in with the declared account, keep the session, and report both defects here.',
    safeNotes: 'Corrected control behind the same form sign-in.',
  }),
  ...pair('login_wall', {
    axis: 'authenticated', journey: 'session', method: ['crawl', 'runtime-dom'],
    tpPath: 'auth/wall/broken.html', safePath: 'auth/wall/safe.html',
    access: { ...gates['soft-wall'], sign_in_page: form.sign_in_page },
    notes: 'Behind a soft sign-in wall: unauthenticated, the server answers 200 with a sign-in page in '
      + 'place of this one. Signed in, the page carries both defects.',
    safeNotes: 'Corrected control behind the same soft wall. A scanner that never got past the wall '
      + 'and reports a clean result for this page has passed the sign-in page, not this one.',
  }),
  ...accounting('login_wall_unreached', {
    tp: {
      path: 'access/auth/wall/broken.html', access: gates['soft-wall'],
      assertion: {
        kind: 'authenticated-target-reached',
        inputs: {
          requested: 'access/auth/wall/broken.html', credential_supplied: false,
          response_status: 200, evaluated_title: 'Sign in to continue',
        },
        expected_execution: expectation({
          status: 'blocked', declaredState: 'authenticated', stateReached: false,
          observability: 'not-observed', examined: { operator: 'unavailable' },
          errorCode: 'sign-in-required', forbidPass: true,
        }),
      },
      notes: 'The run had no credential, asked for the account page, got 200 and evaluated the sign-in '
        + 'page in its place. Any verdict about the account page is unfounded: the run must report it '
        + 'blocked, never passed.',
    },
    control: {
      path: 'access/auth/wall/safe.html', access: gates['soft-wall'],
      assertion: {
        kind: 'authenticated-target-reached',
        inputs: {
          requested: 'access/auth/wall/safe.html', credential_supplied: true,
          response_status: 200, evaluated_title: 'Your trips (behind a sign-in wall, corrected)',
        },
        expected_execution: expectation({
          status: 'completed', declaredState: 'authenticated', stateReached: true,
          observability: 'observed', examined: { operator: 'at-least', value: 1 },
        }),
      },
      notes: 'The matched control signed in and evaluated the page it asked for.',
    },
  }),
  ...accounting('session_lost', {
    tp: {
      path: 'access/auth/form/index.html', access: gates['form-login'],
      assertion: {
        kind: 'session-preserved',
        inputs: {
          sampled_pages: ['access/auth/form/index.html', 'access/auth/form/orders.html'],
          followed: ['access/auth/form/index.html', 'access/auth/form/logout', 'access/auth/form/orders.html'],
          evaluated_as_sign_in: ['access/auth/form/orders.html'],
        },
        expected_execution: expectation({
          status: 'error', declaredState: 'authenticated', stateReached: false,
          observability: 'not-observed', examined: { operator: 'unavailable' },
          errorCode: 'session-lost', forbidPass: true,
        }),
      },
      notes: 'The crawler followed Sign out, the first link on the account home, and every page after it '
        + 'was the sign-in page. Pages evaluated after the session ended must not be credited.',
    },
    control: {
      path: 'access/auth/form/index.html', access: gates['form-login'],
      assertion: {
        kind: 'session-preserved',
        inputs: {
          sampled_pages: ['access/auth/form/index.html', 'access/auth/form/orders.html'],
          followed: ['access/auth/form/index.html', 'access/auth/form/orders.html'],
          evaluated_as_sign_in: [],
        },
        expected_execution: expectation({
          status: 'completed', declaredState: 'authenticated', stateReached: true,
          observability: 'observed', examined: { operator: 'at-least', value: 2 },
        }),
      },
      notes: 'The matched control left Sign out alone and kept the session for every sampled page.',
    },
  }),
  ...pair('authenticated_fetch', {
    axis: 'authenticated', journey: 'async', method: ['crawl', 'runtime-dom'],
    tpPath: 'auth/form/dynamic.html', safePath: 'auth/form/safe_dynamic.html',
    access: { ...gates['form-login'], sign_in_page: form.sign_in_page },
    notes: 'Both questions at once: behind the form sign-in, and the defect arrives in a fragment fetched '
      + 'after load. The fragment is gated too, so the session must ride on the fetch.',
    safeNotes: 'Corrected control: same sign-in, same fetch, corrected fragment.',
  }),
  ...pair('fetched_fragment', {
    axis: 'dynamic', journey: 'async', method: ['runtime-dom'],
    tpPath: 'dynamic/fetched.html', safePath: 'dynamic/safe_fetched.html',
    notes: 'The served page is a shell; the defect arrives in an HTML fragment fetched after the load '
      + 'event. Not in the served bytes, and not present until a network round trip completes.',
    safeNotes: 'Corrected control: same fetch, corrected fragment.',
  }),
  ...pair('spa_route', {
    axis: 'dynamic', journey: 'navigate', method: ['runtime-dom', 'interaction', 'state-exploration'],
    tpPath: 'dynamic/spa_route.html', safePath: 'dynamic/safe_spa_route.html',
    extra: { state_dependency: 'script' },
    notes: 'The defect is on a client-side route. The router renders Settings on a click and pushes a URL '
      + 'that, loaded directly, serves Trips again. Only a run that drives the router reaches it.',
    safeNotes: 'Corrected control with the same router and the corrected Settings view.',
  }),
  ...pair('never_idle', {
    axis: 'dynamic', journey: 'realtime', method: ['runtime-dom'],
    tpPath: 'dynamic/never_idle.html', safePath: 'dynamic/safe_never_idle.html',
    notes: 'A clock rewrites part of the page every 200 ms, forever. The defect is present at load. A run '
      + 'that waits for the DOM to settle never finishes; it must bound its wait and still report.',
    safeNotes: 'Corrected control that also never goes quiet.',
  }),
];

const label = (testCase) => testCase.id.replace(/^access-/, '');
write('index.html', page('index.html', 'Access fixtures',
  `<p>Content a scanner has to get to before it can judge it: pages behind a sign-in, and content that
arrives after load. Gated pages are only gated when served by <code>serve.mjs</code>.</p>
<ul>${cases.map((testCase) => `<li><a href="../${testCase.path}">${label(testCase)}</a> — <em>${testCase.axis}</em>, ${testCase.mode === 'tp' ? 'carries the defect' : 'control'}</li>`).join('\n')}</ul>`));

const credentials = Object.fromEntries(Object.entries(ACCESS_CREDENTIALS).map(([id, value]) => [id, { ...value }]));

fs.writeFileSync(path.join(ROOT, 'access.json'), `${JSON.stringify({
  format: 'cognium-a11y-access-cases',
  format_version: '1.0.0',
  description: 'Content a scanner has to reach before it can judge it. The authenticated axis is gated by '
    + 'serve.mjs; the dynamic axis adds fetched fragments, client-side routes and a page that never settles. '
    + 'Defect-carrying pages carry the same constant pair as the delivery family.',
  constant_defect: { '2.1.1': 'div styled as a button, not focusable', '1.1.1': 'img with no accessible name' },
  credentials_note: 'Public synthetic credentials. They pass the gates in access-gate.mjs and grant nothing '
    + 'outside this corpus. Real credentials never belong in this repository.',
  credentials,
  generated: new Date().toISOString().slice(0, 10),
  cases,
}, null, 2)}\n`);

const count = (axis) => cases.filter((testCase) => testCase.axis === axis).length;
console.log(`${cases.length} access cases: ${count('authenticated')} authenticated, ${count('dynamic')} dynamic`);
