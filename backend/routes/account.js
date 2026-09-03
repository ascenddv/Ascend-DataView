/**
 * GET /api/account/export — a full JSON dump of everything the acting
 * organization owns (organization, members without hashes, standardized data,
 * chat messages, AscendAI usage, invitations). Owner + verified. Scoped to
 * req.auth.orgId — no id parameter, nothing to tamper with.
 */

const express = require('express');

const { exportOrganizationData } = require('../db');
const { requireRole } = require('../middleware/requireRole');
const { requireVerified } = require('../middleware/requireVerified');

const router = express.Router();

router.get('/account/export', requireRole('owner'), requireVerified, async (req, res, next) => {
  try {
    const bundle = await exportOrganizationData(req.auth.orgId);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ascenddv-export-org${req.auth.orgId}-${stamp}.json"`
    );
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
