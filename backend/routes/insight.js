/**
 * GET /api/insight — the AI narrative for the current dataset.
 *
 * Recomputes metrics deterministically (same path as /api/metrics), then hands
 * only those computed aggregates to generateInsight(). Raw rows never leave the
 * DB layer.
 */

const express = require('express');

const { getStandardizedData } = require('../db');
const { buildMetrics } = require('../services/buildMetrics');
const { generateInsight } = require('../services/generateInsight');
const { insightLimiter } = require('../middleware/rateLimit');
const { insightEnabled } = require('../config/aiFlags');

const router = express.Router();

const disabledInsight = (reason) => ({
  status: 'unavailable',
  why: null,
  recommendation: null,
  model: null,
  generatedAt: new Date().toISOString(),
  reason,
});

router.get('/insight', insightLimiter, async (req, res, next) => {
  try {
    if (!insightEnabled()) {
      return res.json({ ok: true, ...disabledInsight('AI insight is turned off for this deployment.') });
    }
    const rows = await getStandardizedData(req.auth.orgId);
    const metrics = buildMetrics(rows);

    let insight;
    try {
      insight = await generateInsight(metrics);
    } catch (llmErr) {
      // The narrative is optional — the dashboard renders fine without it. A
      // provider failure (quota, timeout, outage) is a soft "unavailable", not
      // a 500, so the client degrades cleanly with no console error.
      console.warn(`/api/insight: generation failed — ${llmErr.message}`);
      insight = {
        status: 'unavailable',
        why: null,
        recommendation: null,
        model: null,
        generatedAt: new Date().toISOString(),
        reason: 'Insight generation is temporarily unavailable.',
      };
    }

    res.json({ ok: true, ...insight });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
