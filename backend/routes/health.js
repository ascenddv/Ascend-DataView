const express = require('express');

const { getDb } = require('../db');

const router = express.Router();

/**
 * Liveness + a shallow readiness signal. Always HTTP 200 (this is mounted
 * before the DB gate so a monitor can still reach it during an outage); the
 * body reports whether a `SELECT 1` succeeded.
 */
router.get('/health', async (_req, res) => {
  let db = 'down';
  try {
    await getDb().query('SELECT 1');
    db = 'ok';
  } catch {
    db = 'down';
  }
  res.json({ status: db === 'ok' ? 'ok' : 'degraded', db });
});

module.exports = router;
