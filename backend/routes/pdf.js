/**
 * GET /api/report.pdf — a point-in-time PDF snapshot of the Overview dashboard
 * for the authenticated session's organization (Phase 16).
 *
 * No new auth surface and NO org parameter: the org is taken from req.auth,
 * exactly like /api/metrics and /api/insight, so there is nothing to tamper
 * with. Same deterministic buildMetrics() payload as the rest of the app —
 * a PDF is just another rendering of it, stamped as a snapshot.
 */

const express = require('express');

const { getStandardizedData, getOrganizationById } = require('../db');
const { buildMetrics } = require('../services/buildMetrics');
const { generateInsight } = require('../services/generateInsight');
const { buildOverviewPdf } = require('../services/pdfReport');
const { pdfLimiter } = require('../middleware/rateLimit');
const { captureError } = require('../services/observability');

const router = express.Router();

router.get('/report.pdf', pdfLimiter, async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const [rows, org] = await Promise.all([
      getStandardizedData(orgId),
      getOrganizationById(orgId),
    ]);
    const metrics = buildMetrics(rows);

    // The narrative is optional — a provider failure must not fail the export.
    let insight = null;
    if (metrics.dataset.periodCount > 0) {
      try {
        insight = await generateInsight(metrics);
      } catch (llmErr) {
        captureError(llmErr, { code: 'GEMINI_FAILURE', path: '/api/report.pdf', orgId: req.auth.orgId });
        insight = null;
      }
    }

    const generatedAt = new Date().toISOString();
    const pdf = await buildOverviewPdf(metrics, insight, {
      orgName: org ? org.name : 'Organization',
      generatedAt,
    });

    const filename = `ascenddv-overview-${generatedAt.slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
