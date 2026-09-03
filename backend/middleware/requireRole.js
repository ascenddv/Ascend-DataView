/**
 * Role gate — runs after requireAuth (which sets req.auth.role). Used for the
 * owner-only surface: team invites, member removal, data reset, and (Phase 27)
 * org deletion + data export.
 *
 *   router.post('/…', requireRole('owner'), handler)
 */

function requireRole(...allowed) {
  return function roleGate(req, res, next) {
    if (req.auth && allowed.includes(req.auth.role)) return next();
    return res.status(403).json({
      ok: false,
      error: `This action requires the ${allowed.join(' or ')} role.`,
    });
  };
}

module.exports = { requireRole };
