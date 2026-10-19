// Generate state-drivers.json: how to reach the state each case is about.
//
//   node state-drivers.mjs
//
// A fixture already declares *what* state it is about -- `ui_state`, `journey`,
// and `steps` for multi-page walks. Nothing declared *how to reach* a
// non-default state on a single page, so a harness could load the page,
// photograph the default state, and report a miss on a defect it never
// rendered (#46). The only interaction knowledge that existed was imperative
// Playwright in `check/scenario-interactions.mjs`, covering a handful of cases
// and consumable by nothing but itself.
//
// Every case declaring a non-default `ui_state` or an `interaction` /
// `state-exploration` method gets an answer here, and there are only four:
//
//   at-load         the page renders its declared state when loaded. Most of
//                   the corpus is here, and it is not a gap -- see below.
//   declared-steps  a multi-page walk already enumerated in the case's own
//                   `steps`; each page loads in its own right.
//   interaction     reached by the declarative steps below, proven by a
//                   post-condition.
//   not-drivable    nothing can reach it, with the reason recorded.
//
// ## Why most of these are `at-load`, and why that is a finding and not a dodge
//
// #46 assumes the harness "loads the default state and photographs the front
// door" for all 38 cases declaring a non-default `ui_state`. Measured in a
// browser, 31 of those 38 contain no script at all. A page with no script can
// only ever be in one state: the one it renders. There is nothing to drive,
// and those cases were never hidden from any engine.
//
// The measurement that makes this concrete also corrects a natural mistake.
// Probing `ui-states/invalid.html` for `[aria-invalid="true"]` says the page is
// *not* in an invalid state -- but that page's own defect is that "the field is
// not marked invalid". The missing attribute is the defect, not evidence of an
// undriven state. A state-driver contract that tested for correct exposure
// would be testing for the correction, so `at-load` here records what the page
// depicts, and the post-conditions below never assert a criterion's fix.
//
// ## Fixtures are not touched
//
// Several drivers would be shorter if a fixture grew an id. None did. The
// selectors below address the pages as they already are, because a corpus that
// edits its fixtures to be easier to drive has made its own cases easier to
// detect, which is the one thing a benchmark must not do (#46, last criterion).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCorpus } from './check/scoring.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

/**
 * Fixtures the hand-written Playwright suite opens.
 *
 * #46 asks that the imperative knowledge and the declared knowledge cannot
 * drift. Reading the list out of the suite itself, rather than restating it,
 * is what makes that true by construction: the contract is a superset of what
 * that file touches, and adding a page there without declaring it here fails
 * the contract test.
 */
export function imperativelyDrivenPaths(root) {
  const source = fs.readFileSync(path.join(root, 'check/scenario-interactions.mjs'), 'utf8');
  return new Set([...source.matchAll(/open\('([^']+)'\)/g)].map((match) => match[1]));
}

/** A case needs an answer here if it claims a state or an interaction. */
export function needsDriver(fixture, drivenPaths = new Set()) {
  return (fixture.ui_state && fixture.ui_state !== 'default')
    || (fixture.method ?? []).some((m) => m === 'interaction' || m === 'state-exploration')
    || drivenPaths.has(fixture.path);
}

/**
 * Can this page reach a second state after it has loaded?
 *
 * Not "does it carry script": `ui-states/safe_error.html` runs one line that
 * focuses an alert at load and binds nothing. It has a script and exactly one
 * state. What makes a page drivable is something bound to an event.
 */
export function hasInteractiveHandlers(html) {
  return /addEventListener\s*\(/.test(html) || /\son[a-z]+\s*=\s*["']/i.test(html);
}

const click = (selector) => ({ action: 'click', selector });
const focus = (selector) => ({ action: 'focus', selector });
const press = (key, selector) => (selector ? { action: 'press', key, selector } : { action: 'press', key });
const fill = (selector, value) => ({ action: 'fill', selector, value });
const dispatch = (selector, event, init, note) => ({
  action: 'dispatch', selector, event, ...(init ? { init } : {}), ...(note ? { note } : {}),
});
const text = (selector, pattern, note) => ({
  kind: 'text-matches', selector, pattern, ...(note ? { note } : {}),
});

// --- the wiring family ------------------------------------------------------
//
// Eight pages asking the same question in eight ways: can a scanner tell this
// element is interactive. The handler is in an inline attribute, in a
// listener, on an ancestor, or bound to pointer events only. Every one of them
// uses `#target` for the control and `#state` for what it changes, so the
// driver is identical and the *page* is the variable. That regularity is the
// point of the family and it survives into the contract.
const WIRING = [
  'inline_attribute', 'element_listener', 'delegated_ancestor', 'pointer_only',
];

// --- hand-authored interaction drivers --------------------------------------
//
// Keyed by case id. Each was executed against the real fixture and its
// post-condition checked false-before / true-after, so none of these is a
// plausible-looking selector nobody ran.
const INTERACTION = {
  // 2.4.3 Focus Order. The popover ships `hidden` and the trigger removes it,
  // so `:not([hidden])` is false at load and true once opened. The condition
  // deliberately does not assert that focus moved into the popover: on the
  // broken page it does not, and that is the defect, not a failed drive.
  'scenario-overlay_focus_trap': {
    steps: [click('#fare-open')],
    post_condition: { kind: 'present', selector: '#po:not([hidden])' },
  },
  'scenario-safe_overlay_focus_trap': {
    steps: [click('#fare-open')],
    post_condition: { kind: 'present', selector: '#po:not([hidden])' },
  },

  // 2.5.7 Dragging Movements. The state worth reaching is "the list has been
  // reordered", and the page announces that into #order-status, which is empty
  // until something moves. Driven from the keyboard: the page supports the
  // arrow keys, and reaching a state is not the same as proving the criterion
  // -- the assertion is that no single-pointer path exists, which is judged
  // from the page, not from how this driver got there.
  'scenario-dragging_required': {
    steps: [focus('#legs li:first-child .handle'), press('ArrowDown', '#legs li:first-child .handle')],
    post_condition: text('#order-status', 'Order:'),
  },
  'scenario-safe_dragging_required': {
    steps: [click('#legs li:first-child .down')],
    post_condition: text('#order-status', 'Order:'),
  },

  // 2.5.7 again as a swipe. #fare carries "1 of 3" at load and a different
  // index afterwards, so the index is the observable.
  'scenario-swipe_required': {
    steps: [focus('#fares'), press('ArrowRight', '#fares')],
    post_condition: text('#fare', '2 of 3'),
  },
  'scenario-safe_swipe_required': {
    steps: [click('#fare-next')],
    post_condition: text('#fare', '2 of 3'),
  },

  // 2.5.4 Motion Actuation. The broken page offers no control at all, so a
  // devicemotion event is the only way in -- and it must carry `acceleration`,
  // because the listener ignores an event without one.
  'scenario-motion_actuation': {
    steps: [dispatch('window', 'devicemotion', { acceleration: { x: 20, y: 0, z: 0 } },
      'the listener ignores a devicemotion with no acceleration')],
    post_condition: text('#seat-status', 'undone'),
  },
  'scenario-safe_motion_actuation': {
    steps: [click('#undo')],
    post_condition: text('#seat-status', 'undone'),
  },

  // 2.5.2 Pointer Cancellation. The defect fires on pointer-down, so the
  // driver fires pointer-down: a click sends down and up together and hides
  // the distinction the case exists to measure.
  'scenario-pointer_cancellation': {
    steps: [dispatch('button', 'pointerdown', { bubbles: true })],
    post_condition: text('#pointer-status', 'cancelled'),
  },
  'scenario-safe_pointer_cancellation': {
    steps: [click('button')],
    post_condition: text('#pointer-status-safe', 'cancelled'),
  },

  // 2.1.2 No Keyboard Trap. Opening the panel and putting focus inside it is
  // the state; whether focus can then leave is the assertion.
  'scenario-keyboard_trap': {
    steps: [click('#trap-trigger'), focus('#trap-field')],
    post_condition: { kind: 'focus-within', selector: '#trap-panel' },
  },
  'scenario-safe_keyboard_trap': {
    steps: [click('#trap-trigger-safe'), focus('#trap-field-safe')],
    post_condition: { kind: 'focus-within', selector: '#trap-dialog-safe' },
  },

  // 3.2.1 On Focus. Focusing the field swaps the panel for results, and the
  // results section ships `hidden`.
  'scenario-change_on_focus': {
    steps: [focus('#focus-destination')],
    post_condition: { kind: 'present', selector: '#focus-results:not([hidden])' },
  },
  // The control changes nothing on focus, so the state to reach is simply the
  // field being focused. Asserting that no context change happened would be
  // asserting the criterion, which belongs to the scorer and not here.
  'scenario-safe_change_on_focus': {
    steps: [focus('#focus-destination-safe')],
    post_condition: { kind: 'focus-within', selector: '#focus-destination-safe' },
  },

  // 3.2.2 On Input. The destination is a <select>, which `fill` cannot
  // address; choosing an option is what triggers the change.
  'scenario-change_on_input': {
    steps: [{ action: 'select', selector: '#input-destination', value: 'Rome' }],
    post_condition: { kind: 'present', selector: '#input-step-two:not([hidden])' },
  },
  'scenario-safe_change_on_input': {
    steps: [
      { action: 'select', selector: '#input-destination-safe', value: 'Rome' },
      click('button'),
    ],
    post_condition: { kind: 'present', selector: '#input-step-two-safe:not([hidden])' },
  },

  // AAA 2.5.6 Concurrent Input Mechanisms. The stepper shows 1 at load; the
  // keyboard path is the one the broken page disables after a pointer is used,
  // so pressing Enter on Increase is what shows whether it still works.
  'aaa-concurrent_input': {
    steps: [focus('#inc'), press('Enter', '#inc')],
    post_condition: text('#n', '2'),
  },
  'aaa-safe_concurrent_input': {
    steps: [focus('#inc'), press('Enter', '#inc')],
    post_condition: text('#n', '2'),
  },

  // AAA 3.3.6 Error Prevention (All). #state is empty until the form is
  // submitted; the broken page sends immediately and the control interposes a
  // review step, so the two differ in what lands there.
  'aaa-error_prevention_all': {
    steps: [fill('#to', 'ACME Ltd'), fill('#amt', '2500'), click('#send')],
    post_condition: text('#state', '\\S'),
  },
  // The review section ships `hidden` but already carries its heading text, so
  // the observable has to be whether it is shown, not whether it has content.
  'aaa-safe_error_prevention_all': {
    steps: [fill('#to', 'ACME Ltd'), fill('#amt', '2500'), click('#send')],
    post_condition: { kind: 'present', selector: '#review:not([hidden])' },
  },

  // AAA 2.2.5 Re-authenticating. The page ships an explicit control to expire
  // the session, so the state is reachable without waiting out a real timeout.
  'aaa-re_authenticating': {
    steps: [fill('#a', 'Window seat'), click('#expire')],
    post_condition: text('#state', 'Session expired'),
  },
  'aaa-safe_re_authenticating': {
    steps: [fill('#a', 'Window seat'), click('#expire')],
    post_condition: text('#state', 'Session expired'),
  },

  // AAA 2.2.1 Timing Adjustable. The form expires on a real 30-second clock
  // with no control to trigger it, so the only honest driver is to wait it
  // out. Slow, and correct: shortening the clock to suit a runner would change
  // the fixture, and declaring the state unreachable would be false -- it is
  // reachable, it just costs 31 seconds.
  'aaa-no_timing': {
    steps: [{ action: 'wait', timeout_ms: 31000, note: 'the page offers no control to expire it early' }],
    post_condition: text('#clock', 'expired'),
  },

  // AAA 2.4.12 Focus Not Obscured (Enhanced). There is nothing to measure
  // until a control is focused; the condition names the control itself rather
  // than an ancestor, so it is false while focus is still on the document.
  'aaa-focus_not_obscured_enhanced': {
    steps: [focus('main button:last-of-type')],
    post_condition: { kind: 'focus-within', selector: 'main button:last-of-type' },
  },
  'aaa-safe_focus_not_obscured_enhanced': {
    steps: [focus('main button:last-of-type')],
    post_condition: { kind: 'focus-within', selector: 'main button:last-of-type' },
  },

  // 1.4.1 Use of Colour. The page toggles seat class on click, so "Business is
  // selected" is a reachable second state, observed by the class the page
  // itself uses. Not aria-pressed: this page has none, and that absence is
  // part of its defect. Its control twin declares the default state and no
  // interaction method, so it needs no driver.
  'color-selection_color_only': {
    steps: [click('main div button:nth-of-type(2)')],
    post_condition: { kind: 'present', selector: 'main div button:nth-of-type(2).sel' },
  },
  // AAA 2.4.13 Focus Appearance. Same shape: no indicator exists to measure
  // until something has focus.
  'aaa-focus_appearance': {
    steps: [focus('main button')],
    post_condition: { kind: 'focus-within', selector: 'main button' },
  },
  'aaa-safe_focus_appearance': {
    steps: [focus('main button')],
    post_condition: { kind: 'focus-within', selector: 'main button' },
  },
};

// Cases whose declared state no runner can reach, and why. Recorded rather
// than left as a silent absence of steps: "nobody wrote a driver" and "no
// driver is possible" are different facts and only one of them is a backlog.
// Nothing is here today. The category stays because "no runner can reach this"
// is a real answer that some future case will need, and leaving it out would
// push that case towards a driver nobody can execute. `aaa-no_timing` was the
// obvious candidate and turned out not to qualify: its 30-second clock is slow
// to wait out, not unreachable.
const NOT_DRIVABLE = {};

function driverFor(fixture) {
  const base = { case_id: fixture.id, path: fixture.path, declared_state: fixture.ui_state ?? 'default' };

  if (NOT_DRIVABLE[fixture.id]) {
    return { ...base, reached: 'not-drivable', reason: NOT_DRIVABLE[fixture.id] };
  }

  if (fixture.scope === 'multi-page' && (fixture.steps ?? []).length > 0) {
    return {
      ...base,
      reached: 'declared-steps',
      reason: `The walk is already enumerated in this case's own steps (${fixture.steps.length} pages); `
        + 'each page loads in its own right, so there is no single-page state to drive.',
    };
  }

  const wiringPair = WIRING.find((slug) => fixture.id === `wiring-${slug}` || fixture.id === `wiring-safe_${slug}`);
  if (wiringPair) {
    return {
      ...base,
      reached: 'interaction',
      steps: [click('#target')],
      post_condition: text('#state', 'Activated'),
    };
  }

  const hand = INTERACTION[fixture.id];
  if (hand) return { ...base, reached: 'interaction', ...hand };

  const html = fs.readFileSync(path.join(ROOT, fixture.path), 'utf8');
  const scripted = /<script/i.test(html);
  return {
    ...base,
    reached: 'at-load',
    reason: scripted
      ? 'The page binds nothing to an event: its script runs once at load and cannot move it to '
        + 'another state. It renders exactly the state it declares, and an engine that loaded it '
        + 'saw that state.'
      : 'The page contains no script, so it renders exactly one state: the one it declares. '
        + 'There is nothing to drive, and an engine that loaded it saw the state the case is about.',
  };
}

const corpus = loadCorpus(ROOT);
const drivenPaths = imperativelyDrivenPaths(ROOT);

// A hand-authored driver for a case that does not need one never runs, so
// nothing verifies its selectors -- and it would switch on, unverified, the
// day that case gained an interaction method. Fail now instead.
const selected = new Set([...corpus.cases.values()]
  .filter((fixture) => needsDriver(fixture, drivenPaths))
  .map((fixture) => fixture.id));
const unreachable = Object.keys(INTERACTION).filter((id) => !selected.has(id));
if (unreachable.length) {
  throw new Error(`hand-authored drivers for cases that need none: ${unreachable.join(', ')}`);
}
const drivers = [...corpus.cases.values()]
  .filter((fixture) => needsDriver(fixture, drivenPaths))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(driverFor);

const out = {
  $schema: './schemas/state-drivers.schema.json',
  format: 'cognium-a11y-state-drivers',
  format_version: '1.0.0',
  generated: new Date().toISOString().slice(0, 10),
  policy: {
    scope: 'Every case declaring a non-default ui_state or an interaction / state-exploration '
      + 'method answers here. A case in the default state with no interaction method needs no '
      + 'declaration, and its absence is not a gap.',
    evidence: 'An `interaction` driver carries a post-condition that is false before its steps '
      + 'run and true after. A runner reports state_reached from that observable rather than '
      + 'assuming, so "state never reached" and "state reached, defect missed" stay distinct.',
    fixtures: 'No fixture was changed to make a driver shorter or a defect easier to detect. '
      + 'Selectors address the pages as they already are.',
  },
  drivers,
};

fs.writeFileSync(path.join(ROOT, 'state-drivers.json'), `${JSON.stringify(out, null, 2)}\n`);

const counts = drivers.reduce((acc, d) => ({ ...acc, [d.reached]: (acc[d.reached] ?? 0) + 1 }), {});
console.log(`state-drivers.json: ${drivers.length} cases — ${JSON.stringify(counts)}`);
