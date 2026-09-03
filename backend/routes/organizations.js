/**
 * Organization-scoped endpoints.
 *
 *   POST   /api/organizations/:id/onboarding-complete   mark first-run done
 *   DELETE /api/organizations/:id/data                  destructive data reset (owner)
 *   GET    /api/organizations/:id/members               team roster (any member)
 *   DELETE /api/organizations/:id/members/:userId       remove a member (owner)
 *   POST   /api/organizations/:id/invitations           invite someone (owner, verified)
 *   GET    /api/organizations/:id/invitations           pending invites (owner)
 *   DELETE /api/organizations/:id/invitations/:token    revoke an invite (owner)
 *
 * Every route first checks that :id equals the session's org_id (`sameOrg`) —
 * no org can act on another by changing the path parameter.
 */

const express = require('express');
const crypto = require('crypto');

const {
  getOrganizationById,
  deleteStandardizedData,
  setOnboardingCompleted,
  getUserByEmail,
  listOrgMembers,
  removeOrgMember,
  createInvitation,
  listPendingInvitations,
  deleteInvitation,
  deleteOrganization,
} = require('../db');
const { requireRole } = require('../middleware/requireRole');
const { requireVerified } = require('../middleware/requireVerified');
const { inviteLimiter } = require('../middleware/rateLimit');
const { sendEmail, invitationEmail } = require('../services/email');
const { cookieOptions, COOKIE_NAME } = require('../services/auth');
const { INVITATION_TTL_HOURS } = require('../config/thresholds');

const router = express.Router();

/** :id in the path must be the caller's own org. */
function sameOrg(req, res, next) {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId !== req.auth.orgId) {
    return res.status(403).json({ ok: false, error: 'You can only act on your own organization.' });
  }
  next();
}

const newToken = () => crypto.randomBytes(32).toString('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/organizations/:id/onboarding-complete', sameOrg, async (req, res, next) => {
  try {
    const value = await setOnboardingCompleted(req.auth.orgId, true);
    res.json({ ok: true, onboardingCompleted: value === true });
  } catch (err) {
    next(err);
  }
});

router.delete('/organizations/:id/data', sameOrg, requireRole('owner'), async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const org = await getOrganizationById(orgId);
    if (!org) return res.status(404).json({ ok: false, error: 'Organization not found.' });

    const confirm = String((req.body && req.body.confirm) || '').trim();
    if (confirm !== org.name) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation text did not match the organization name. Nothing was deleted.',
      });
    }

    const deleted = await deleteStandardizedData(orgId);
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

/**
 * Permanently delete the whole organization — every user, dataset, chat, usage
 * row and invitation, via the cascade FKs. Owner + verified, typed-name
 * confirmation, and the session cookie is cleared on the way out (all of the
 * org's sessions are dead the moment its users are gone).
 */
router.delete('/organizations/:id', sameOrg, requireRole('owner'), requireVerified, async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const org = await getOrganizationById(orgId);
    if (!org) return res.status(404).json({ ok: false, error: 'Organization not found.' });

    const confirm = String((req.body && req.body.confirm) || '').trim();
    if (confirm !== org.name) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation text did not match the organization name. Nothing was deleted.',
      });
    }

    await deleteOrganization(orgId);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

/* -- team roster --------------------------------------------------------- */

router.get('/organizations/:id/members', sameOrg, async (req, res, next) => {
  try {
    const members = await listOrgMembers(req.auth.orgId);
    res.json({
      ok: true,
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        emailVerified: Boolean(m.email_verified_at),
        createdAt: m.created_at,
        isYou: m.id === req.auth.userId,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/organizations/:id/members/:userId', sameOrg, requireRole('owner'), async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId)) {
      return res.status(400).json({ ok: false, error: 'Invalid member id.' });
    }
    if (targetUserId === req.auth.userId) {
      return res.status(400).json({ ok: false, error: 'You cannot remove yourself.' });
    }
    // removeOrgMember refuses to delete an owner; distinguish that from "no such member".
    const members = await listOrgMembers(req.auth.orgId);
    const target = members.find((m) => m.id === targetUserId);
    if (!target) return res.status(404).json({ ok: false, error: 'No such member in this organization.' });
    if (target.role === 'owner') {
      return res.status(403).json({ ok: false, error: 'Owners cannot be removed.' });
    }

    const removed = await removeOrgMember(req.auth.orgId, targetUserId);
    if (!removed) return res.status(404).json({ ok: false, error: 'No such member in this organization.' });
    res.json({ ok: true, removed });
  } catch (err) {
    next(err);
  }
});

/* -- invitations ------------------------------------------------------------ */

router.post(
  '/organizations/:id/invitations',
  sameOrg,
  requireRole('owner'),
  requireVerified,
  inviteLimiter,
  async (req, res, next) => {
    try {
      const orgId = req.auth.orgId;
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      const role = req.body && req.body.role === 'owner' ? 'owner' : 'member';

      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ ok: false, error: 'A valid email address is required.' });
      }
      if (await getUserByEmail(email)) {
        return res
          .status(409)
          .json({ ok: false, error: 'Someone with that email already has an AscendDV account.' });
      }

      const token = newToken();
      await createInvitation({
        orgId,
        email,
        role,
        invitedByUserId: req.auth.userId,
        token,
        ttlHours: INVITATION_TTL_HOURS,
      });

      const org = await getOrganizationById(orgId);
      try {
        await sendEmail(invitationEmail(email, token, org ? org.name : null));
      } catch (err) {
        console.error(`invitation email failed for ${email}: ${err.message}`);
      }

      res.status(201).json({ ok: true, invitation: { email, role } });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/organizations/:id/invitations', sameOrg, requireRole('owner'), async (req, res, next) => {
  try {
    const rows = await listPendingInvitations(req.auth.orgId);
    res.json({
      ok: true,
      invitations: rows.map((r) => ({
        token: r.token,
        email: r.email,
        role: r.role,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete(
  '/organizations/:id/invitations/:token',
  sameOrg,
  requireRole('owner'),
  async (req, res, next) => {
    try {
      const revoked = await deleteInvitation(req.auth.orgId, req.params.token);
      if (!revoked) return res.status(404).json({ ok: false, error: 'No such pending invitation.' });
      res.json({ ok: true, revoked: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
