/**
 * Known-breached-password check via the Have I Been Pwned range API
 * (k-anonymity: only the first 5 chars of the SHA-1 hash leave this process).
 *
 * Used on signup and password reset, on top of the length rule in
 * validateCredentials. It is a best-effort safety net, not a gate: if HIBP is
 * unreachable or slow we FAIL OPEN (return false) so a third party's outage
 * can never lock people out of creating an account or resetting a password.
 * Each fail-open emits a `HIBP_DEGRADED` signal via the observability layer so
 * a silently-broken check is visible in the logs / Sentry.
 *
 * The off-switch (`HIBP_CHECK_ENABLED`) uses the shared config/envFlags parser,
 * so it accepts the same disable words (0/false/off/no) as INSIGHT_ENABLED etc.
 */

const crypto = require('crypto');

const { flagIsOff } = require('../config/envFlags');
const { captureMessage } = require('./observability');

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2500;

/**
 * @param {string} plain
 * @returns {Promise<boolean>} true only if HIBP positively reports the password
 *   as seen in a breach; false on "not found" AND on any error/timeout.
 */
async function isBreachedPassword(plain) {
  if (!plain) return false;
  // Deliberate off-switch for offline / air-gapped deploys or a HIBP outage
  // you'd rather not wait on. Off => behaves exactly like "not breached".
  if (flagIsOff(process.env.HIBP_CHECK_ENABLED)) return false;
  const sha1 = crypto.createHash('sha1').update(String(plain), 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // TEMPORARY, read-only, off by default (HIBP_DEBUG_TIMING unset in every
  // real deployment) — added to chase a Phase 31 CI mystery: this function
  // has returned a false negative for a known-breached password in CI while
  // an equivalent bare fetch succeeded, with no error/timeout signal either
  // way. Logs the abort-timer's state and elapsed time at each point below;
  // changes no logic, no return value, no control flow. Remove once resolved.
  const DEBUG = Boolean(process.env.HIBP_DEBUG_TIMING);
  const t0 = Date.now();
  let timerFired = false;
  const dbg = (label, extra = '') => {
    if (DEBUG) console.error(`[HIBP_DEBUG_TIMING] ${label} t=${Date.now() - t0}ms timerFired=${timerFired} ${extra}`);
  };

  const ac = new AbortController();
  const timer = setTimeout(() => {
    timerFired = true;
    dbg('abort-timer-fired');
    ac.abort();
  }, TIMEOUT_MS);
  try {
    const res = await fetch(HIBP_RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      signal: ac.signal,
    });
    dbg('fetch-resolved', `status=${res.status}`);
    if (!res.ok) {
      // Fail open, but make the degradation visible — a silently-broken breach
      // check should show up in the logs / Sentry, not just vanish.
      captureMessage('HIBP_DEGRADED', { reason: `HIBP responded ${res.status}` });
      return false;
    }
    const body = await res.text();
    dbg('res.text()-resolved', `bodyLength=${body.length}`);
    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix && hashSuffix.toUpperCase() === suffix) {
        dbg('match-found');
        return Number(countRaw) > 0;
      }
    }
    dbg('no-match-in-body');
    return false;
  } catch (err) {
    dbg('caught', `name=${err && err.name} message=${err && err.message}`);
    captureMessage('HIBP_DEGRADED', { reason: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'network error' });
    return false; // network error / timeout / abort — fail open
  } finally {
    dbg('finally-before-clearTimeout');
    clearTimeout(timer);
  }
}

module.exports = { isBreachedPassword };
