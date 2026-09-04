/**
 * Phase 28 gate — AI kill-switches + usage visibility.
 *
 * Three backends on the local Postgres:
 *   - "flagsOff": INSIGHT_ENABLED=false, ASCENDAI_ENABLED=false
 *   - "flagsOn":  defaults (both AI features on), GEMINI/DEEPSEEK keys blank so
 *                 the AI paths degrade through the *provider* "unavailable"
 *                 route — lets the gate prove the kill-switch "unavailable" is a
 *                 distinct, clearly-worded response and everything non-AI is
 *                 untouched.
 *   - "stubbed":  DEEPSEEK_API_KEY set + DEEPSEEK_BASE_URL pointed at a local
 *                 stub that returns a real OpenAI-shaped completion (with a
 *                 `usage` object), so the real provider-response -> trace.usage
 *                 -> sumUsage -> ascendai_usage -> /api/ascendai/usage path runs
 *                 end to end against a real HTTP response, not hand-seeded rows.
 *
 *   node scripts/phase28-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const db = require('../db');
const {
  ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG: CAP,
  ASCENDAI_CHAT_BURST_LIMIT: BURST,
} = require('../config/thresholds');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const OFF = 'http://localhost:3161';
const ON = 'http://localhost:3162';
const STUBBED = 'http://localhost:3163';
const STUB_PROVIDER_PORT = 3170;
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const PW = 'ascend-gate-K7m2Qp-Zx9';

// Minimal OpenAI-compatible chat/completions stub. Returns a final answer (no
// tool calls) with a real `usage` object so sumUsage() has the exact shape it
// parses in production.
const STUB_USAGE = { prompt_tokens: 111, completion_tokens: 22, total_tokens: 133 };
function startProviderStub(port) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'stub-cmpl', object: 'chat.completion', model: 'stub',
        choices: [{ index: 0, finish_reason: 'stop',
          message: { role: 'assistant', content: 'Stubbed answer for the Phase 28 gate.' } }],
        usage: STUB_USAGE,
      }));
    });
  });
  server.listen(port);
  return server;
}

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(base, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* */ }
    await sleep(250);
  }
  throw new Error(`${base} never became healthy`);
}
function startBackend(port, extraEnv) {
  return spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env, PORT: String(port), DATABASE_URL: LOCAL_PG,
      HIBP_CHECK_ENABLED: '0', RESEND_API_KEY: '', APP_BASE_URL: `http://localhost:${port}`,
      GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '', ...extraEnv,
    },
    stdio: 'ignore',
  });
}
function makeClient(base) {
  let cookie = null;
  return {
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(base + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, json: async () => r.json().catch(() => null) };
    },
  };
}
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(`${ROOT}/data/${f}`)], { type: 'text/csv' }), f);
  return fd;
};
const clearLimits = () => db.getDb().query('DELETE FROM rate_limits');
async function signupVerified(base, label) {
  const c = makeClient(base);
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const email = `p28_${label}_${s}@t.co`;
  const r = await c.req('POST', '/api/auth/signup', { body: { email, password: PW, orgName: `P28 ${label} ${s}`, acceptTos: true } });
  const org = (await r.json()).org;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  await c.req('POST', '/api/auth/login', { body: { email, password: PW } });
  return { c, org };
}

const procs = [];
let providerStub;
try {
  await db.initDb();
  providerStub = startProviderStub(STUB_PROVIDER_PORT);
  procs.push(startBackend(3161, { INSIGHT_ENABLED: 'false', ASCENDAI_ENABLED: 'false' }));
  procs.push(startBackend(3162, {}));
  procs.push(startBackend(3163, {
    DEEPSEEK_API_KEY: 'stub-key-not-real',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${STUB_PROVIDER_PORT}`,
  }));
  await waitHealth(OFF);
  await waitHealth(ON);
  await waitHealth(STUBBED);

  /* ============================================================ */
  console.log('\n== 1. global flags off: AI endpoints return "unavailable", the rest is fine ==');
  const off = await signupVerified(OFF, 'off');
  await clearLimits();
  await off.c.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });

  const insight = await off.c.req('GET', '/api/insight');
  const insightBody = await insight.json();
  check('GET /api/insight -> 200 { status: "unavailable" }, wording names the deployment switch',
    insight.status === 200 && insightBody.status === 'unavailable' && /turned off for this deployment/i.test(insightBody.reason || ''),
    JSON.stringify(insightBody.reason));

  const metrics = await off.c.req('GET', '/api/metrics');
  const metricsBody = await metrics.json();
  check('GET /api/metrics is unaffected — still 200 with the uploaded data',
    metrics.status === 200 && (metricsBody?.dataset?.periodCount || 0) > 0, `periodCount=${metricsBody?.dataset?.periodCount}`);
  const pdf = await off.c.req('GET', '/api/report.pdf');
  check('GET /api/report.pdf still works with AI off', pdf.status === 200);

  await clearLimits();
  const chat = await off.c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
  const chatBody = await chat.json();
  check('POST /api/ascendai/chat -> 200 { status: "unavailable" }, deployment wording',
    chat.status === 200 && chatBody.status === 'unavailable' && /turned off for this deployment/i.test(chatBody.reason || ''),
    JSON.stringify(chatBody.reason));
  const usageOff = await (await off.c.req('GET', '/api/ascendai/usage')).json();
  check('GET /api/ascendai/usage reports enabled:false', usageOff.enabled === false);

  /* ============================================================ */
  console.log('\n== 2. flags on: the per-org AscendAI toggle isolates one org from another ==');
  const a = await signupVerified(ON, 'orgA');
  const b = await signupVerified(ON, 'orgB');

  const patch = await a.c.req('PATCH', `/api/organizations/${a.org.id}`, { body: { ascendaiEnabled: false } });
  check('owner A PATCH { ascendaiEnabled:false } -> 200', patch.status === 200 && (await patch.json()).ascendaiEnabled === false);

  await clearLimits();
  const aChat = await a.c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
  const aChatBody = await aChat.json();
  check('org A chat -> "unavailable" with the per-ORG wording',
    aChat.status === 200 && aChatBody.status === 'unavailable' && /turned off for your organization/i.test(aChatBody.reason || ''),
    JSON.stringify(aChatBody.reason));
  check('org A usage -> enabled:false', (await (await a.c.req('GET', '/api/ascendai/usage')).json()).enabled === false);

  await clearLimits();
  const bChat = await b.c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
  const bChatBody = await bChat.json();
  check('org B is unaffected — chat still reaches the provider path (degrades, not the org switch)',
    bChat.status === 200 && bChatBody.status === 'unavailable' && !/turned off/i.test(bChatBody.reason || ''),
    JSON.stringify(bChatBody.reason));
  check('org B usage -> enabled:true', (await (await b.c.req('GET', '/api/ascendai/usage')).json()).enabled === true);

  // a member cannot flip the toggle
  await clearLimits();
  await b.c.req('POST', `/api/organizations/${b.org.id}/invitations`, { body: { email: `p28_m_${Date.now()}@t.co` } });
  const itoken = (await db.getDb().query(
    'SELECT token FROM invitations WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1', [b.org.id]
  )).rows[0].token;
  const memberClient = makeClient(ON);
  await memberClient.req('POST', '/api/auth/accept-invite', { body: { token: itoken, password: PW } });
  const memberPatch = await memberClient.req('PATCH', `/api/organizations/${b.org.id}`, { body: { ascendaiEnabled: false } });
  check('a member PATCH -> 403', memberPatch.status === 403, `-> ${memberPatch.status}`);

  /* ============================================================ */
  console.log('\n== 3. usage counts + token totals are accurate ==');
  const uid = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='owner' LIMIT 1", [b.org.id])).rows[0].id;
  for (let i = 0; i < 3; i += 1) {
    await db.recordAscendaiUsage(b.org.id, uid, { status: 'ok', promptTokens: 100, completionTokens: 40, totalTokens: 140 });
  }
  const bUsage = await (await b.c.req('GET', '/api/ascendai/usage')).json();
  // org B already ran one real chat turn in §2 that degraded to
  // status:'unavailable' (no provider key). It must NOT be in this count —
  // only the 3 status:'ok' rows just seeded are billable turns.
  check('org B usage: today.count is exactly the 3 billable (status:ok) turns — the earlier failed turn is excluded',
    bUsage.today.count === 3, `count=${bUsage.today.count}`);
  check('org B usage: token totals add up (>= 3 * 140)',
    bUsage.tokens.total >= 420 && bUsage.tokens.prompt >= 300, JSON.stringify(bUsage.tokens));
  check('org B usage: the limit is the configured daily cap', bUsage.today.limit > 0);

  /* ============================================================ */
  console.log('\n== 4. flags on: /api/insight degrades via the provider path, not the switch ==');
  await clearLimits();
  const onInsight = await b.c.req('GET', '/api/insight');
  const onInsightBody = await onInsight.json();
  check('GET /api/insight (flags on, no key) -> "unavailable" WITHOUT the deployment wording',
    onInsight.status === 200 && onInsightBody.status === 'unavailable' && !/turned off/i.test(onInsightBody.reason || ''),
    JSON.stringify(onInsightBody.reason));

  /* ============================================================ */
  console.log('\n== 5. an AI outage does not consume the daily cap (failed turns are logged, not counted) ==');
  // Fresh org C on the flags-on backend. No provider key, so every real chat
  // turn degrades to status:'unavailable'.
  const cCtx = await signupVerified(ON, 'orgC');
  const cUid = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='owner' LIMIT 1", [cCtx.org.id])).rows[0].id;

  // Simulate a long outage: CAP failed turns recorded.
  for (let i = 0; i < CAP; i += 1) {
    await db.recordAscendaiUsage(cCtx.org.id, cUid, { status: 'unavailable', promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }
  const outageRows = (await db.getDb().query(
    "SELECT count(*)::int AS n FROM ascendai_usage WHERE org_id=$1 AND status='unavailable'", [cCtx.org.id]
  )).rows[0].n;
  check(`the ${CAP} failed turns ARE persisted (observability preserved)`, outageRows >= CAP, `rows=${outageRows}`);
  check('db.countAscendaiUsageSince ignores them — billable count is still 0',
    (await db.countAscendaiUsageSince(cCtx.org.id, new Date(Date.now() - 3600e3).toISOString())) === 0);
  const cUsage = await (await cCtx.c.req('GET', '/api/ascendai/usage')).json();
  check(`GET /api/ascendai/usage: today.count is 0 despite ${CAP} failed turns`, cUsage.today.count === 0, `count=${cUsage.today.count}`);

  await clearLimits();
  const cChat = await cCtx.c.req('POST', '/api/ascendai/chat', { body: { message: 'still there?' } });
  const cChatBody = await cChat.json();
  check('a new turn after the outage is NOT rate_limited — it still reaches the provider path',
    cChat.status === 200 && cChatBody.status === 'unavailable' && !/message limit|daily limit/i.test(cChatBody.reason || ''),
    JSON.stringify(cChatBody.reason));

  // Positive control: CAP *billable* turns DO trip the cap.
  for (let i = 0; i < CAP; i += 1) {
    await db.recordAscendaiUsage(cCtx.org.id, cUid, { status: 'ok', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  }
  await clearLimits();
  const cCapped = await cCtx.c.req('POST', '/api/ascendai/chat', { body: { message: 'one more' } });
  const cCappedBody = await cCapped.json();
  check(`after ${CAP} status:ok turns the SAME endpoint returns status:rate_limited (cap still works for real usage)`,
    cCapped.status === 200 && cCappedBody.status === 'rate_limited' && /limit/i.test(cCappedBody.reason || ''),
    JSON.stringify(cCappedBody.reason));

  /* ============================================================ */
  console.log('\n== 6. a disabled org: flooding chat past the burst limit reaches neither the provider nor the usage log ==');
  // The unit tests prove "disabled org -> provider not called, no usage row"
  // against a mocked handler. This proves it live, and across a whole flood
  // that also crosses the burst-limiter threshold (which sits *before* the
  // kill-switch in the middleware chain).
  const dis = await signupVerified(ON, 'flood');
  const patchDis = await dis.c.req('PATCH', `/api/organizations/${dis.org.id}`, { body: { ascendaiEnabled: false } });
  check('owner disables AscendAI for the flood org -> 200', patchDis.status === 200 && (await patchDis.json()).ascendaiEnabled === false);

  await clearLimits();
  await db.getDb().query('DELETE FROM ascendai_usage WHERE org_id = $1', [dis.org.id]);
  const FLOOD = BURST + 7;
  const floodStatuses = [];
  for (let i = 0; i < FLOOD; i += 1) {
    const r = await dis.c.req('POST', '/api/ascendai/chat', { body: { message: `flood ${i}` } });
    floodStatuses.push((await r.json())?.status);
  }
  const killSwitched = floodStatuses.slice(0, BURST);
  const burstLimited = floodStatuses.slice(BURST);
  check(`the first ${BURST} turns hit the kill-switch (status:"unavailable")`,
    killSwitched.every((s) => s === 'unavailable'), killSwitched.join(','));
  check(`turns ${BURST + 1}..${FLOOD} are shed by the burst limiter (status:"rate_limited")`,
    burstLimited.length > 0 && burstLimited.every((s) => s === 'rate_limited'), burstLimited.join(','));
  const floodRows = (await db.getDb().query(
    'SELECT count(*)::int AS n FROM ascendai_usage WHERE org_id = $1', [dis.org.id]
  )).rows[0].n;
  check(`ZERO ascendai_usage rows after all ${FLOOD} turns — no turn reached recordAscendaiUsage, hence none reached the provider`,
    floodRows === 0, `rows=${floodRows}`);

  /* ============================================================ */
  console.log('\n== 7. a real provider response: usage flows end-to-end into /api/ascendai/usage (not hand-seeded) ==');
  const stub = await signupVerified(STUBBED, 'stub');
  await clearLimits();
  const stChat = await stub.c.req('POST', '/api/ascendai/chat', { body: { message: 'what is my cash balance?' } });
  const stChatBody = await stChat.json();
  check('stubbed provider turn -> status "ok" with a non-empty reply',
    stChat.status === 200 && stChatBody.status === 'ok' && typeof stChatBody.reply === 'string' && stChatBody.reply.length > 0,
    JSON.stringify(stChatBody.status));
  const stUsage = await (await stub.c.req('GET', '/api/ascendai/usage')).json();
  check('the usage view shows the REAL parsed token counts from the provider response body',
    stUsage.today.count === 1 &&
    stUsage.tokens.prompt === STUB_USAGE.prompt_tokens &&
    stUsage.tokens.completion === STUB_USAGE.completion_tokens &&
    stUsage.tokens.total === STUB_USAGE.total_tokens,
    JSON.stringify(stUsage.tokens));

  console.log(`\n${fail === 0 ? 'ALL PHASE 28 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  if (providerStub) providerStub.close();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
