/**
 * POST /api/auth/signup               — create an org + its first user, log them in, email a verify link
 * POST /api/auth/login                — verify credentials, issue a session cookie
 * POST /api/auth/logout               — clear the session cookie (this browser only)
 * POST /api/auth/logout-all           — revoke every session for the current user
 * POST /api/auth/verify-email         — consume a verification token
 * POST /api/auth/resend-verification  — email a fresh verification link (auth'd)
 * POST /api/auth/forgot-password      — email a reset link (always 200, no enumeration)
 * POST /api/auth/reset-password       — consume a reset token: set the hash, kill sessions, verify the email (one txn)
 * GET  /api/auth/me                   — current session's user + org (authenticated:false if none)
 */

const express = require('express');
const crypto = require('crypto');

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
  bumpTokenVersion,
  createEmailVerification,
  consumeEmailVerification,
  createPasswordReset,
  applyPasswordReset,
  getInvitationByToken,
  acceptInvitation,
} = require('../db');
const { isBreachedPassword } = require('../services/passwordCheck');
const { sendEmail, verificationEmail, passwordResetEmail } = require('../services/email');
const { runAfterResponse } = require('../services/deferred');
const {
  PASSWORD_MIN_LENGTH,
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_HOURS,
} = require('../config/thresholds');
const { authLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const BREACHED_MSG =
  'That password has appeared in a known data breach. Please choose a different one.';
const newToken = () => crypto.randomBytes(32).toString('hex');

function setSession(res, user) {
  const token = signToken({
    userId: user.id,
    orgId: user.org_id,
    email: user.email,
    tokenVersion: user.token_version || 0,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function publicUser(user) {
  return { email: user.email, role: user.role, emailVerified: Boolean(user.email_verified_at) };
}
function publicOrg(org) {
  return {
    id: org.id,
    name: org.name,
    onboardingCompleted: org.onboarding_completed === true,
    ascendaiEnabled: org.ascendai_enabled !== false,
  };
}

/** Best-effort: mint + store a verification token and email it. Never throws. */
async function issueVerification(user) {
  try {
    const token = newToken();
    await createEmailVerification(user.id, token, EMAIL_VERIFICATION_TTL_HOURS);
    await sendEmail(verificationEmail(user.email, token));
  } catch (err) {
    console.error(`verification email failed for user ${user.id}: ${err.message}`);
  }
}

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { email, password, orgName, acceptTos } = req.body || {};

    const errors = validateCredentials({ email, password });
    if (!orgName || !String(orgName).trim()) errors.push('An organization name is required.');
    // Strict `!== true`, not `!acceptTos`: only the literal boolean sent by the
    // signup form's checkbox counts as consent. A stringified "true", a 1, or a
    // stray object must not pass. This is a signing owner affirmatively ticking
    // a box that shows the Terms + Privacy links; the timestamp recorded in
    // users.tos_accepted_at is evidence of that act. (Invited members take a
    // different, weaker path — see routes below and db.acceptInvitation.)
    if (acceptTos !== true) {
      errors.push('You must agree to the Terms of Service and Privacy Policy.');
    }
    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors.join(' ') });
    }
    if (await isBreachedPassword(String(password))) {
      return res.status(400).json({ ok: false, error: BREACHED_MSG });
    }

    if (await getUserByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'An account with that email already exists.' });
    }

    const org = await createOrganization({ name: String(orgName).trim() });
    const passwordHash = await hashPassword(String(password));
    const user = await createUser({ orgId: org.id, email, passwordHash, role: 'owner', tosAccepted: true });

    await issueVerification(user);
    setSession(res, user);
    res.status(201).json({ ok: true, user: publicUser(user), org: publicOrg(org) });
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
    res.json({ ok: true, user: publicUser(user), org: publicOrg(org) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

// Sign out everywhere: bump the user's token_version so every JWT minted at the
// old value (this browser and any other) fails requireAuth on its next request.
router.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await bumpTokenVersion(req.auth.userId);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// The token in the body is the credential here — no session required (people
// click the link from an email client, not necessarily the logged-in browser).
router.post('/verify-email', authLimiter, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const result = await consumeEmailVerification(String(token || ''));
    if (!result) {
      return res.status(400).json({
        ok: false,
        error: 'That verification link is invalid or has expired. Request a new one from your account.',
      });
    }
    res.json({ ok: true, emailVerified: true });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.auth.userId);
    if (!user) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
    await issueVerification(user);
    res.json({ ok: true, sent: true });
  } catch (err) {
    next(err);
  }
});

// Always 200 with the same body, whether or not the email maps to an account —
// the response must not tell an attacker which addresses are registered, by
// body OR by timing. The real branch's token INSERT + email send therefore run
// AFTER the response is sent, so both branches return right after the same
// getUserByEmail lookup.
//
// runAfterResponse registers that background block with Vercel's per-request
// waitUntil() when running on Vercel, so the function isn't frozen and the
// reset email dropped once the response flushes; off Vercel it is a plain
// detached promise. See services/deferred.js.
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const user = email ? await getUserByEmail(email) : null;
    res.json({ ok: true });
    if (user) {
      runAfterResponse(async () => {
        const token = newToken();
        await createPasswordReset(user.id, token, PASSWORD_RESET_TTL_HOURS);
        await sendEmail(passwordResetEmail(user.email, token));
      }, `password reset email for user ${user.id}`);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};

    // Validate the NEW password before consuming the token, so a weak choice
    // doesn't burn a one-time link.
    if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
      return res
        .status(400)
        .json({ ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    if (await isBreachedPassword(String(password))) {
      return res.status(400).json({ ok: false, error: BREACHED_MSG });
    }

    // One transaction: claim the token, set the new hash, bump token_version
    // (kills every session), and stamp email_verified_at. All-or-nothing.
    const claim = await applyPasswordReset(String(token || ''), await hashPassword(String(password)));
    if (!claim) {
      return res.status(400).json({
        ok: false,
        error: 'That reset link is invalid or has expired. Request a new one.',
      });
    }

    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Accept a team invitation. The invite ROW (looked up by the random 32-byte
// token) is the sole source of org_id, role and email — the invitee supplies
// only a password; any org_id/role/email in the request body is ignored.
//
// The account's email is marked verified on accept. The security boundary here
// is POSSESSION OF THE LINK, not proof of mailbox control: whoever opens the
// (single-use, 72h, owner-revocable) link becomes the invited email in the org.
// This matches the "anyone with the link" model used by GitHub/Slack invites.
//
// CONSENT: there is no ToS checkbox on this flow. Accepting the invite is
// treated as acceptance, and db.acceptInvitation stamps tos_accepted_at = now().
// That timestamp therefore means "accepted the invite link", NOT "was shown and
// affirmatively ticked a Terms checkbox" — a weaker consent record than the
// signing owner's (see the /signup handler above). If an evidentiary consent
// record is ever required for members, add the checkbox to AcceptInvitePage and
// gate this route on it.
router.post('/accept-invite', authLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    const inv = await getInvitationByToken(String(token || ''));
    if (!inv) {
      return res.status(400).json({
        ok: false,
        error: 'That invitation link is invalid, was revoked, or has expired.',
      });
    }
    if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
      return res
        .status(400)
        .json({ ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    if (await isBreachedPassword(String(password))) {
      return res.status(400).json({ ok: false, error: BREACHED_MSG });
    }
    if (await getUserByEmail(inv.email)) {
      return res
        .status(409)
        .json({ ok: false, error: 'An account with that email already exists. Sign in instead.' });
    }

    const user = await acceptInvitation({
      token: inv.token,
      email: inv.email,
      passwordHash: await hashPassword(String(password)),
    });
    if (!user) {
      return res.status(400).json({ ok: false, error: 'That invitation is no longer valid.' });
    }

    const org = await getOrganizationById(user.org_id);
    setSession(res, user);
    res.status(201).json({ ok: true, user: publicUser(user), org: publicOrg(org) });
  } catch (err) {
    next(err);
  }
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
    const tokenTv = Number.isInteger(payload.tv) ? payload.tv : 0;
    if (tokenTv !== user.token_version) return res.json({ ok: true, authenticated: false });
    const org = await getOrganizationById(user.org_id);

    res.json({ ok: true, authenticated: true, user: publicUser(user), org: publicOrg(org) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
