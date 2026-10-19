// Execute a declarative state driver and report, honestly, whether the state
// was reached.
//
// The contract in `state-drivers.json` is selector-plus-action so that any
// runner can execute it. This is one such runner, written against Playwright
// because that is what the repo already has; nothing in the contract is
// specific to it, and a second implementation should be able to read the same
// file and agree.
//
// The point of the post-condition is that `state_reached` stops being an
// assumption. A harness that drives a page and does not check whether the
// drive worked reports "state reached, defect missed" for a page it never got
// into the state -- two completely different facts about a product collapsed
// into one miss.

import fs from 'node:fs';
import path from 'node:path';

export const DRIVERS_FILE = 'state-drivers.json';

/** Steps that need no driving: the state is there, or declared elsewhere. */
const STATIC = new Set(['at-load', 'declared-steps']);

export function loadDrivers(root) {
  const file = path.join(root, DRIVERS_FILE);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(parsed.drivers.map((driver) => [driver.case_id, driver]));
}

async function runStep(page, step) {
  const timeout = step.timeout_ms ?? 5000;
  switch (step.action) {
    case 'click':
      return page.click(step.selector, { timeout });
    case 'focus':
      return page.focus(step.selector, { timeout });
    case 'hover':
      return page.hover(step.selector, { timeout });
    case 'fill':
      return page.fill(step.selector, step.value, { timeout });
    case 'select':
      return page.selectOption(step.selector, step.value, { timeout });
    case 'press':
      return step.selector
        ? page.press(step.selector, step.key, { timeout })
        : page.keyboard.press(step.key);
    case 'wait':
      return step.selector
        ? page.waitForSelector(step.selector, { timeout })
        : page.waitForTimeout(step.timeout_ms ?? 100);
    case 'dispatch':
      // Deliberately a real DOM event rather than a synthesised user gesture:
      // these cases are about handlers bound below the level a click reaches.
      return page.evaluate(
        ({ selector, event, init }) => {
          const target = selector === 'window' ? window : document.querySelector(selector);
          if (!target) throw new Error(`dispatch target not found: ${selector}`);
          // A plain Event carries none of the fields these handlers read --
          // a devicemotion with no `acceleration` is ignored by its own
          // listener, which would make the driver silently do nothing.
          const Ctor = event.startsWith('pointer') ? PointerEvent
            : event.startsWith('key') ? KeyboardEvent
              : event.startsWith('mouse') ? MouseEvent
                : event === 'devicemotion' ? (window.DeviceMotionEvent ?? Event)
                  : Event;
          target.dispatchEvent(new Ctor(event, { bubbles: true, cancelable: true, ...(init ?? {}) }));
        },
        { selector: step.selector, event: step.event, init: step.init },
      );
    default:
      throw new Error(`unknown action: ${step.action}`);
  }
}

async function checkCondition(page, condition) {
  const { kind, selector, pattern, attribute, value, count } = condition;
  return page.evaluate(
    ({ kind, selector, pattern, attribute, value, count }) => {
      const all = selector ? [...document.querySelectorAll(selector)] : [];
      const first = all[0];
      switch (kind) {
        case 'present': return all.length > 0;
        case 'absent': return all.length === 0;
        case 'count-at-least': return all.length >= count;
        case 'text-matches':
          return Boolean(first) && new RegExp(pattern).test(first.textContent ?? '');
        case 'attribute-equals':
          return Boolean(first) && first.getAttribute(attribute) === value;
        case 'focus-within':
          return Boolean(first) && (first === document.activeElement || first.contains(document.activeElement));
        default: return false;
      }
    },
    { kind, selector, pattern, attribute, value, count },
  );
}

/**
 * Drive one case into its declared state.
 *
 * Returns `{ state_reached, before, after }`. `before` is the post-condition
 * evaluated *before* any step runs: a condition already true at load is not
 * evidence that the steps did anything, and saying so is the difference
 * between a driver that works and one that was never exercised.
 */
export async function driveCase({ browser, root, driver, baseUrl }) {
  if (STATIC.has(driver.reached)) {
    return { state_reached: true, before: null, after: null, drove: false };
  }
  if (driver.reached === 'not-drivable') {
    return { state_reached: false, before: null, after: null, drove: false };
  }

  const page = await browser.newPage();
  try {
    const url = baseUrl ? `${baseUrl}/${driver.path}` : `file://${path.join(root, driver.path)}`;
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    const before = await checkCondition(page, driver.post_condition);
    for (const step of driver.steps) await runStep(page, step);
    const after = await checkCondition(page, driver.post_condition);

    return { state_reached: after === true, before, after, drove: true };
  } finally {
    await page.close();
  }
}
