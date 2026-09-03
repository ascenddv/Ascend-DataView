const express = require('express');

const { getDb } = require('../db');
const { captureMessage } = require('../services/observability');

const router = express.Router();

// Per-process transition tracking so a sustained outage logs once (on the way
// down and again on recovery), not once per health poll.
let lastDbState = 'ok';

/**
 * Liveness + a shallow readiness signal. Always HTTP 200 (this is mounted
 * before the DB gate so a monitor can still reach it during an outage); the
 * body reports whether a `SELECT 1` succeeded. A state change emits a signal so
 * the failure isn't fully silent.
 */
router.get('/health', async (_req, res) => {
  let db = 'down';
  let reason = null;
  try {
    await getDb().query('SELECT 1');
    db = 'ok';
  } catch (err) {
    reason = err && err.message;
  }

  if (db !== lastDbState) {
    captureMessage(db === 'down' ? 'HEALTH_DB_DOWN' : 'HEALTH_DB_RECOVERED', { reason });
    lastDbState = db;
  }

  res.json({ status: db === 'ok' ? 'ok' : 'degraded', db });
});

module.exports = router;
