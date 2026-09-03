/**
 * Internal maintenance endpoints — not part of the user API, no session.
 *
 * POST (or GET) /api/internal/prune — runs the retention prune (pruneOldRows).
 * Called by the Vercel Cron declared in vercel.json. Vercel automatically sends
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set in the project;
 * an `x-cron-secret` header is accepted too for manual runs. Rejects with 401
 * if the secret is missing or wrong (and if CRON_SECRET itself is unset).
 */

const express = require('express');

const { pruneOldRows } = require('../db');
const { captureError } = require('../services/observability');

const router = express.Router();

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const header = req.get('x-cron-secret') || '';
  return bearer === secret || header === secret;
}

async function handlePrune(req, res, next) {
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const pruned = await pruneOldRows();
    res.json({ ok: true, pruned });
  } catch (err) {
    captureError(err, { code: 'PRUNE_FAILURE' });
    next(err);
  }
}

router.post('/internal/prune', handlePrune);
router.get('/internal/prune', handlePrune); // Vercel Cron issues a GET

module.exports = router;
