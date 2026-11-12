// One navigation, retried once when it times out.
//
// Siteimprove Alfa loaded delivery/client_js.html in 1.2 s in the published run and
// hit the 30 s navigation limit in the 11 November weekly run, while the other five
// tools read the same page in under 5 s. A page that did not load is recorded as an
// error, and an error where the published bundle had a score reads as a lost
// detection. So a timeout gets one more try; an HTTP failure or a second timeout is
// still an error, and is recorded as one.

export const NAVIGATION_TIMEOUT_MS = 30000;

const isTimeout = (error) => error?.name === 'TimeoutError' || /Navigation timeout/i.test(String(error?.message ?? ''));

/** `goto` is `() => Promise<response>`. Returns the response of the first try that does not time out. */
export async function navigateWithRetry(goto, { attempts = 2 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await goto();
    } catch (error) {
      last = error;
      if (!isTimeout(error)) throw error;
    }
  }
  throw last;
}
