/**
 * GET /api/metrics — computed metrics, health scores, and card eligibility for
 * the current standardized dataset. All deterministic; no LLM involved.
 */

const express = require('express');

const { getStandardizedData } = require('../db');
const { buildMetrics } = require('../services/buildMetrics');

const router = express.Router();

router.get('/metrics', async (req, res, next) => {
  try {
    const rows = await getStandardizedData(req.auth.orgId);
    const metrics = buildMetrics(rows);
    res.json({ ok: true, ...metrics });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
