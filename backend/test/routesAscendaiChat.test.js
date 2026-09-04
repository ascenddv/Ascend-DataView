/**
 * POST/GET/DELETE /api/ascendai/chat (Phase 19) — route-level coverage with the
 * DB layer and askAscendAI() stubbed (no live Postgres, no provider). Verifies
 * the capped history window, persistence only on success, per-org rate limiting,
 * graceful degradation, usage logging, and (org_id, user_id) scoping.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  ASCENDAI_HISTORY_WINDOW_MESSAGES,
  ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG,
} = require('../config/thresholds');

/* --- stub ../db and the chat service BEFORE requiring the route ---------- */
const dbId = require.resolve('../db');
const chatId = require.resolve('../services/ascendai/chat');

const calls = {
  countAscendaiUsageSince: [],
  getRecentChatMessages: [],
  insertChatMessage: [],
  recordAscendaiUsage: [],
  deleteChatMessages: [],
};
const state = {
  usedToday: 0,
  recent: [],
  deleteReturns: 0,
  askResult: null,
  askInput: null,
  orgAscendaiEnabled: true,
};

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    async countAscendaiUsageSince(orgId, since) {
      calls.countAscendaiUsageSince.push([orgId, since]);
      return state.usedToday;
    },
    async getRecentChatMessages(orgId, userId, limit) {
      calls.getRecentChatMessages.push([orgId, userId, limit]);
      return state.recent;
    },
    async insertChatMessage(orgId, userId, role, content) {
      calls.insertChatMessage.push([orgId, userId, role, content]);
      return { id: calls.insertChatMessage.length, role, content, created_at: new Date().toISOString() };
    },
    async recordAscendaiUsage(orgId, userId, row) {
      calls.recordAscendaiUsage.push([orgId, userId, row]);
    },
    async deleteChatMessages(orgId, userId) {
      calls.deleteChatMessages.push([orgId, userId]);
      return state.deleteReturns;
    },
    async getOrganizationById(id) {
      return { id, name: `Org ${id}`, ascendai_enabled: state.orgAscendaiEnabled };
    },
    async sumAscendaiUsageSince() {
      return { count: state.usedToday, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    },
    // Only the chat-burst rate limiter's PgRateStore touches this; a constant
    // low count keeps the limiter a no-op so these tests stay about route logic.
    getDb: () => ({
      query: async () => ({ rows: [{ hits: 1, expires_at: new Date(Date.now() + 60000) }] }),
    }),
  },
};
require.cache[chatId] = {
  id: chatId, filename: chatId, loaded: true, children: [], paths: [],
  exports: {
    async askAscendAI(input) {
      state.askInput = input;
      return state.askResult;
    },
  },
};

const ascendaiRouter = require('../routes/ascendai');

const ORG = 11;
const USER = 22;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { orgId: Number(req.query.as) || ORG, userId: Number(req.query.u) || USER, email: 't@t', emailVerified: true };
  next();
});
app.use('/api', ascendaiRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  state.usedToday = 0;
  state.recent = [];
  state.deleteReturns = 0;
  state.orgAscendaiEnabled = true;
  delete process.env.ASCENDAI_ENABLED;
  state.askResult = { status: 'ok', reply: 'the answer', reason: null, trace: { iterations: 2, usage: [{ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, { prompt_tokens: 130, completion_tokens: 25, total_tokens: 155 }] } };
  state.askInput = null;
};
const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a normal turn: capped history in, both sides persisted, usage logged', async () => {
  reset();
  state.recent = [
    { role: 'user', content: 'q1', created_at: 'a' },
    { role: 'assistant', content: 'a1', created_at: 'b' },
  ];
  const r = await post('/api/ascendai/chat', { message: 'follow up' });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.status, 'ok');
  assert.equal(j.reply, 'the answer');

  // history requested with the configured window and passed through mapped
  assert.deepEqual(calls.getRecentChatMessages[0], [ORG, USER, ASCENDAI_HISTORY_WINDOW_MESSAGES]);
  assert.deepEqual(state.askInput.history, [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
  ]);
  assert.equal(state.askInput.orgId, ORG);

  // usage logged with summed tokens
  assert.deepEqual(calls.recordAscendaiUsage[0], [
    ORG, USER, { status: 'ok', promptTokens: 230, completionTokens: 45, totalTokens: 275, iterations: 2 },
  ]);

  // both messages persisted, in order
  assert.deepEqual(calls.insertChatMessage.map((c) => [c[2], c[3]]), [
    ['user', 'follow up'],
    ['assistant', 'the answer'],
  ]);
});

test('rate limit: at the daily cap the model is never called and nothing is written', async () => {
  reset();
  state.usedToday = ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG;
  const r = await post('/api/ascendai/chat', { message: 'hello' });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.status, 'rate_limited');
  assert.match(j.reply, /message limit/i);
  assert.equal(state.askInput, null, 'askAscendAI not called');
  assert.equal(calls.recordAscendaiUsage.length, 0, 'no usage row for a blocked turn');
  assert.equal(calls.insertChatMessage.length, 0);
});

test('one turn under the cap still runs', async () => {
  reset();
  state.usedToday = ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG - 1;
  const j = await (await post('/api/ascendai/chat', { message: 'ok?' })).json();
  assert.equal(j.status, 'ok');
  assert.equal(calls.recordAscendaiUsage.length, 1);
});

test('provider failure: usage logged, nothing persisted, HTTP 200 not 500', async () => {
  reset();
  state.askResult = { status: 'unavailable', reply: null, reason: 'AscendAI is temporarily unavailable. Please try again in a moment.', trace: { iterations: 1, usage: [] } };
  const r = await post('/api/ascendai/chat', { message: 'anything' });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.status, 'unavailable');
  assert.equal(j.reply, null);
  assert.match(j.reason, /temporarily unavailable/i);
  assert.equal(calls.recordAscendaiUsage[0][2].status, 'unavailable');
  assert.equal(calls.insertChatMessage.length, 0, 'a failed turn leaves no dangling messages');
});

test('empty message -> 400, nothing touched', async () => {
  reset();
  const r = await post('/api/ascendai/chat', { message: '   ' });
  assert.equal(r.status, 400);
  assert.equal(calls.countAscendaiUsageSince.length, 0);
});

test('GET returns this (org,user)\'s conversation, scoped', async () => {
  reset();
  state.recent = [{ role: 'user', content: 'hi', created_at: 'x' }];
  const j = await (await fetch(`${base}/api/ascendai/chat?as=777&u=888`)).json();
  assert.deepEqual(j.messages, [{ role: 'user', content: 'hi', createdAt: 'x' }]);
  assert.deepEqual(calls.getRecentChatMessages[0].slice(0, 2), [777, 888]);
});

test('DELETE clears only this (org,user)\'s conversation', async () => {
  reset();
  state.deleteReturns = 5;
  const j = await (await fetch(`${base}/api/ascendai/chat?as=999&u=111`, { method: 'DELETE' })).json();
  assert.deepEqual(j, { ok: true, cleared: 5 });
  assert.deepEqual(calls.deleteChatMessages[0], [999, 111]);
});

/* -- Phase 28: kill-switches + usage --------------------------------------- */

test('the global ASCENDAI_ENABLED=false flag -> 200 { status: "unavailable" }, provider not called', async () => {
  reset();
  process.env.ASCENDAI_ENABLED = 'false';
  const r = await post('/api/ascendai/chat', { message: 'hi' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'unavailable');
  assert.match(j.reason, /turned off for this deployment/i);
  assert.equal(state.askInput, null); // askAscendAI never ran
  assert.equal(calls.recordAscendaiUsage.length, 0);
});

test('the per-org toggle off -> 200 { status: "unavailable" }, provider not called, no usage row', async () => {
  reset();
  state.orgAscendaiEnabled = false;
  const r = await post('/api/ascendai/chat', { message: 'hi' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'unavailable');
  assert.match(j.reason, /turned off for your organization/i);
  assert.equal(state.askInput, null);
  assert.equal(calls.recordAscendaiUsage.length, 0, 'a switch-blocked turn writes no usage row');
  assert.equal(calls.insertChatMessage.length, 0);
});

test('GET /api/ascendai/usage reports today\'s count, the limit, tokens and enabled', async () => {
  reset();
  state.usedToday = 7;
  const j = await (await fetch(`${base}/api/ascendai/usage`)).json();
  assert.equal(j.enabled, true);
  assert.equal(j.today.count, 7);
  assert.ok(j.today.limit > 0);
  assert.deepEqual(j.tokens, { prompt: 10, completion: 20, total: 30 });

  state.orgAscendaiEnabled = false;
  const j2 = await (await fetch(`${base}/api/ascendai/usage`)).json();
  assert.equal(j2.enabled, false);
});
