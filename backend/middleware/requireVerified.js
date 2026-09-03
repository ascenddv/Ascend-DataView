/**
 * Gate for actions an unverified account may not take yet — upload, AscendAI,
 * team invites, data export. Runs *after* requireAuth, which has already loaded
 * the user and set req.auth.emailVerified.
 *
 * Unverified users can still sign in and view their dashboard; this only blocks
 * the write / spend / share surface. The 403 body carries
 * `needsVerification: true` so the client can show the "verify your email"
 * prompt instead of a generic error.
 */

function requireVerified(req, res, next) {
  if (req.auth && req.auth.emailVerified) return next();
  return res.status(403).json({
    ok: false,
    error: 'Please verify your email address to use this feature. Check your inbox for the verification link.',
    needsVerification: true,
  });
}

module.exports = { requireVerified };
