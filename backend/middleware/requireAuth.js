/**
 * Gate for every /api/* route except health, signup and login.
 *
 * Verifies the JWT from the httpOnly cookie, then attaches
 * `req.auth = { userId, orgId, email }`. Downstream handlers pass
 * `req.auth.orgId` explicitly into every db helper — this middleware is the
 * first check, not the only one.
 */

const { verifyToken, COOKIE_NAME } = require('../services/auth');

function requireAuth(req, res, next) {
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

  req.auth = { userId: payload.userId, orgId: payload.orgId, email: payload.email };
  next();
}

module.exports = { requireAuth };
