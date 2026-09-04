/**
 * AscendAI chat (Stage 4).
 *
 *   POST   /api/ascendai/chat   — one turn, with a capped window of recent
 *                                 history as context; persists both sides on
 *                                 success; per-org daily rate limit; graceful
 *                                 degradation on a provider failure.
 *   GET    /api/ascendai/chat   — this user's stored conversation.
 *   DELETE /api/ascendai/chat   — clear this user's conversation (does not
 *                                 reset the day's usage / rate limit).
 *
 * Behind requireAuth; org_id and user_id come from req.auth exactly like every
 * other endpoint. One org's conversation is never reachable from another's
 * session.
 */

const express = require('express');
const { askAscendAI } = require('../services/ascendai/chat');
const {
  insertChatMessage,
  getRecentChatMessages,
  deleteChatMessages,
  recordAscendaiUsage,
  countAscendaiUsageSince,
  sumAscendaiUsageSince,
  getOrganizationById,
} = require('../db');
const {
  ASCENDAI_HISTORY_WINDOW_MESSAGES,
  ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG,
} = require('../config/thresholds');
const { chatBurstLimiter } = require('../middleware/rateLimit');
const { requireVerified } = require('../middleware/requireVerified');
const { ascendaiEnabled } = require('../config/aiFlags');
const { captureMessage } = require('../services/observability');

const router = express.Router();

const MAX_MESSAGE_CHARS = 4000;
const GET_LIMIT = 200;

// The `trace` (system prompt, every tool call + result, token counts) is a
// debugging aid — never expose it to end users. It is included in the chat
// response only outside production, or when explicitly opted in, so the phase
// gates can still inspect it.
const EXPOSE_TRACE =
  process.env.ASCENDAI_EXPOSE_TRACE === '1' ||
  (process.env.ASCENDAI_EXPOSE_TRACE !== '0' &&
    process.env.NODE_ENV !== 'production' &&
    !process.env.VERCEL);

const RATE_LIMIT_REPLY =
  "You've reached today's AscendAI message limit for your organization. It resets at 00:00 UTC — please try again then.";

function startOfUtcDayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function sumUsage(trace) {
  const acc = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const u of (trace && trace.usage) || []) {
    acc.promptTokens += u.prompt_tokens || 0;
    acc.completionTokens += u.completion_tokens || 0;
    acc.totalTokens += u.total_tokens || 0;
  }
  return acc;
}

// A successful turn should carry at least one provider usage object with the
// OpenAI-style token keys sumUsage() reads. If it does not (the provider
// omitted `usage`, or was swapped for one with a different shape), the token
// telemetry for this turn silently records as zero. sumUsage()'s parsing is
// left as-is on purpose — this only makes the silent-zero case observable.
function usageIsParseable(trace) {
  const entries = (trace && trace.usage) || [];
  return entries.some(
    (u) =>
      u &&
      (Number.isFinite(u.prompt_tokens) ||
        Number.isFinite(u.completion_tokens) ||
        Number.isFinite(u.total_tokens))
  );
}

router.post('/ascendai/chat', requireVerified, chatBurstLimiter, async (req, res, next) => {
  try {
    const { orgId, userId } = req.auth;
    const message =
      req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      return res.status(400).json({ ok: false, error: 'A non-empty "message" is required.' });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res
        .status(400)
        .json({ ok: false, error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` });
    }

    // --- kill-switches: global env flag, then the per-org toggle -------------
    if (!ascendaiEnabled()) {
      return res.json({
        ok: true,
        status: 'unavailable',
        reply: null,
        reason: 'AscendAI is turned off for this deployment.',
      });
    }
    const org = await getOrganizationById(orgId);
    if (org && org.ascendai_enabled === false) {
      return res.json({
        ok: true,
        status: 'unavailable',
        reply: null,
        reason: 'AscendAI has been turned off for your organization by an owner.',
      });
    }

    // --- per-org daily rate limit (defense in depth for the prepaid balance) --
    const usedToday = await countAscendaiUsageSince(orgId, startOfUtcDayIso());
    if (usedToday >= ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG) {
      return res.json({
        ok: true,
        status: 'rate_limited',
        reply: RATE_LIMIT_REPLY,
        reason: `Daily limit of ${ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG} messages reached for this organization.`,
      });
    }

    // --- capped recent history (sliding window, never the whole transcript) ---
    const stored = await getRecentChatMessages(orgId, userId, ASCENDAI_HISTORY_WINDOW_MESSAGES);
    const history = stored.map((m) => ({ role: m.role, content: m.content }));

    const result = await askAscendAI({ message, orgId, history });

    // --- token-usage logging (also the source of truth for the rate limit) ---
    const usage = sumUsage(result.trace);
    if (result.status === 'ok' && !usageIsParseable(result.trace)) {
      // Real answer, but no parseable provider usage — this turn's token
      // totals will record as zero. Surface it rather than hide it.
      captureMessage('ASCENDAI_USAGE_UNPARSED', {
        orgId,
        iterations: (result.trace && result.trace.iterations) || 0,
        usageEntries: ((result.trace && result.trace.usage) || []).length,
      });
    }
    await recordAscendaiUsage(orgId, userId, {
      status: result.status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      iterations: (result.trace && result.trace.iterations) || 0,
    });

    // Persist the turn only when it actually produced an answer — a failed turn
    // must not leave a dangling user message or an "unavailable" assistant turn
    // in the conversation context.
    if (result.status === 'ok') {
      await insertChatMessage(orgId, userId, 'user', message);
      await insertChatMessage(orgId, userId, 'assistant', result.reply);
    }

    res.json({
      ok: true,
      status: result.status,
      reply: result.reply,
      reason: result.reason || null,
      ...(EXPOSE_TRACE ? { trace: result.trace } : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/ascendai/chat', async (req, res, next) => {
  try {
    const { orgId, userId } = req.auth;
    const rows = await getRecentChatMessages(orgId, userId, GET_LIMIT);
    res.json({
      ok: true,
      messages: rows.map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/ascendai/chat', async (req, res, next) => {
  try {
    const { orgId, userId } = req.auth;
    const cleared = await deleteChatMessages(orgId, userId);
    res.json({ ok: true, cleared });
  } catch (err) {
    next(err);
  }
});

// Today's AscendAI usage for the org + whether the feature is on (global flag
// AND the org toggle). Drives the "N of 50 today" line and the panel's
// visibility in the frontend.
router.get('/ascendai/usage', async (req, res, next) => {
  try {
    const { orgId } = req.auth;
    const org = await getOrganizationById(orgId);
    const enabled = ascendaiEnabled() && !(org && org.ascendai_enabled === false);
    const u = await sumAscendaiUsageSince(orgId, startOfUtcDayIso());
    res.json({
      ok: true,
      enabled,
      today: { count: u.count, limit: ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG },
      tokens: {
        prompt: u.prompt_tokens,
        completion: u.completion_tokens,
        total: u.total_tokens,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
