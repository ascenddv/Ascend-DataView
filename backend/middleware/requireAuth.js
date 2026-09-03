/**
 * Gate for every /api/* route except health, signup and login.
 *
 * Verifies the JWT from the httpOnly cookie, confirms the user still exists and
 * the token has not been revoked (its `tv` claim must match the user's current
 * token_version — see Phase 24 / logout-all), then attaches
 * `req.auth = { userId, orgId, email }`. Downstream handlers still pass
 * `req.auth.orgId` explicitly into every db helper — this middleware is the
 * first check, not the only one.
 *
 * The user lookup adds one indexed primary-key read per request. That is the
 * price of revocable sessions: without it a leaked or post-logout token stays
 * valid until it expires.
 */

const { verifyToken, COOKIE_NAME } = require('../services/auth');
const { getUserById } = require('../db');

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session.' });
  }

  if (!Number.isInteger(payload.orgId) || payload.orgId <= 0) {
    return res.status(401).json({ ok: false, error: 'Session is missing an organization scope.' });
  }

  try {
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired session.' });
    }
    // Tokens minted before Phase 24 have no `tv` claim; treat that as 0, which
    // matches the column default, so those sessions survive the upgrade.
    const tokenTv = Number.isInteger(payload.tv) ? payload.tv : 0;
    if (tokenTv !== user.token_version) {
      return res.status(401).json({ ok: false, error: 'This session has been signed out.' });
    }
    req.auth = { userId: user.id, orgId: payload.orgId, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
