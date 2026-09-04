/**
 * Constant-time secret comparison (Stage 5, Phase 31 audit).
 *
 * `a === b` on strings short-circuits — it returns false immediately on a length
 * difference, and at the first differing byte for equal-length inputs. That is a
 * timing oracle: an attacker who can measure response time can recover a secret
 * byte by byte (the same *class* of flaw as the Phase 25 forgot-password timing
 * leak, if far smaller in magnitude).
 *
 * `crypto.timingSafeEqual` is constant-time but throws unless both buffers have
 * the same length — and a naive `if (a.length !== b.length) return false` guard
 * reintroduces a length oracle. So both inputs are first hashed to a fixed
 * 32-byte SHA-256 digest; the comparison then always runs over equal-length
 * buffers and its duration does not depend on where, or whether, the inputs
 * differ. The hashing step's time does vary with input length, but the attacker
 * already knows the length of the value they sent, so nothing about the real
 * secret is revealed.
 */

const crypto = require('crypto');

function timingSafeStrEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { timingSafeStrEqual };
