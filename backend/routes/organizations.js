/**
 * DELETE /api/organizations/:id/data — the explicit, destructive reset (Phase 13).
 *
 * Wipes ALL of the acting org's standardized_data and nothing else. Two guards:
 *   1. :id in the path must equal the session's org_id — no org can target
 *      another org's data by changing the parameter (403 otherwise).
 *   2. the request body must carry `confirm` matching the org's exact name — a
 *      stray or mis-routed request can't wipe data (400 otherwise).
 *
 * The frontend adds its own "type the org name" step; this is the server-side
 * belt-and-suspenders.
 */

const express = require('express');

const {
  getOrganizationById,
  deleteStandardizedData,
  setOnboardingCompleted,
} = require('../db');

const router = express.Router();

/**
 * POST /api/organizations/:id/onboarding-complete (Phase 17) — mark the first-run
 * wizard + tour as done so they don't reappear on the next login. Idempotent.
 * Same :id === session org_id guard as the reset endpoint; no body needed.
 */
router.post('/organizations/:id/onboarding-complete', async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId !== orgId) {
      return res.status(403).json({
        ok: false,
        error: 'You can only update your own organization.',
      });
    }
    const value = await setOnboardingCompleted(orgId, true);
    res.json({ ok: true, onboardingCompleted: value === true });
  } catch (err) {
    next(err);
  }
});

router.delete('/organizations/:id/data', async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const targetId = Number(req.params.id);

    if (!Number.isInteger(targetId) || targetId !== orgId) {
      return res.status(403).json({
        ok: false,
        error: 'You can only reset your own organization’s data.',
      });
    }

    const org = await getOrganizationById(orgId);
    if (!org) {
      return res.status(404).json({ ok: false, error: 'Organization not found.' });
    }

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

module.exports = router;
