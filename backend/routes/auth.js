/**
 * POST /api/auth/signup  — create an organization + its first user, log them in
 * POST /api/auth/login   — verify credentials, issue a session cookie
 * POST /api/auth/logout  — clear the session cookie
 * GET  /api/auth/me      — current session's user + org (401 if not logged in)
 */

const express = require('express');

const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  cookieOptions,
  validateCredentials,
  COOKIE_NAME,
} = require('../services/auth');
const {
  createOrganization,
  createUser,
  getUserByEmail,
  getUserById,
  getOrganizationById,
} = require('../db');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

function setSession(res, user) {
  const token = signToken({ userId: user.id, orgId: user.org_id, email: user.email });
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { email, password, orgName } = req.body || {};

    const errors = validateCredentials({ email, password });
    if (!orgName || !String(orgName).trim()) errors.push('An organization name is required.');
    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors.join(' ') });
    }

    if (await getUserByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'An account with that email already exists.' });
    }

    const org = await createOrganization({ name: String(orgName).trim() });
    const passwordHash = await hashPassword(String(password));
    const user = await createUser({ orgId: org.id, email, passwordHash, role: 'owner' });

    setSession(res, user);
    res.status(201).json({
      ok: true,
      user: { email: user.email, role: user.role },
      org: { id: org.id, name: org.name, onboardingCompleted: org.onboarding_completed === true },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = await getUserByEmail(email);

    // Same response whether the email is unknown or the password is wrong.
    const ok = user && (await verifyPassword(String(password || ''), user.password_hash));
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Incorrect email or password.' });
    }

    const org = await getOrganizationById(user.org_id);
    setSession(res, user);
    res.json({
      ok: true,
      user: { email: user.email, role: user.role },
      org: { id: org.id, name: org.name, onboardingCompleted: org.onboarding_completed === true },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

// Session-status probe for the client to decide login-vs-app. Always 200:
// `authenticated: false` for no/invalid session rather than a 401 (which would
// show up as a console error on every anonymous page load).
router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.json({ ok: true, authenticated: false });

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.json({ ok: true, authenticated: false });
    }

    const user = await getUserById(payload.userId);
    if (!user) return res.json({ ok: true, authenticated: false });
    const org = await getOrganizationById(user.org_id);

    res.json({
      ok: true,
      authenticated: true,
      user: { email: user.email, role: user.role },
      org: { id: org.id, name: org.name, onboardingCompleted: org.onboarding_completed === true },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
