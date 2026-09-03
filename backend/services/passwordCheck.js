/**
 * Known-breached-password check via the Have I Been Pwned range API
 * (k-anonymity: only the first 5 chars of the SHA-1 hash leave this process).
 *
 * Used on signup and password reset, on top of the length rule in
 * validateCredentials. It is a best-effort safety net, not a gate: if HIBP is
 * unreachable or slow we FAIL OPEN (return false) so a third party's outage
 * can never lock people out of creating an account or resetting a password.
 */

const crypto = require('crypto');

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
  if (/^(0|false|off)$/i.test(String(process.env.HIBP_CHECK_ENABLED || ''))) return false;
  const sha1 = crypto.createHash('sha1').update(String(plain), 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HIBP_RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      signal: ac.signal,
    });
    if (!res.ok) return false;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix && hashSuffix.toUpperCase() === suffix) {
        return Number(countRaw) > 0;
      }
    }
    return false;
  } catch {
    return false; // network error / timeout / abort — fail open
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isBreachedPassword };
