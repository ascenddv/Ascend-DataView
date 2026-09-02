/**
 * POST /api/ascendai/chat — one AscendAI chat turn (Stage 4, Phase 18).
 *
 * Single-turn only at this phase: no stored history. Behind requireAuth;
 * `org_id` is taken from req.auth exactly like every other endpoint, and every
 * tool the model can call is scoped by that same id — there is no org parameter
 * to tamper with.
 *
 * A DeepSeek failure returns a clean { status: 'unavailable' } with HTTP 200,
 * never a raw 500, so the rest of the dashboard is unaffected.
 */

const express = require('express');
const { askAscendAI } = require('../services/ascendai/chat');

const router = express.Router();

const MAX_MESSAGE_CHARS = 4000;

router.post('/ascendai/chat', async (req, res, next) => {
  try {
    const orgId = req.auth.orgId;
    const message = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      return res.status(400).json({ ok: false, error: 'A non-empty "message" is required.' });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res
        .status(400)
        .json({ ok: false, error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` });
    }

    const result = await askAscendAI({ message, orgId });

    // `trace` is included for Phase 18 verification (no UI yet); Phase 20 can
    // stop returning it. It only ever contains this org's own computed data.
    res.json({
      ok: true,
      status: result.status,
      reply: result.reply,
      reason: result.reason || null,
      trace: result.trace,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
