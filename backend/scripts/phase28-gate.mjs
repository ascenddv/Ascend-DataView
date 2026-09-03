/**
 * Phase 28 gate — AI kill-switches + usage visibility.
 *
 * Two backends on the local Postgres:
 *   - "flagsOff": INSIGHT_ENABLED=false, ASCENDAI_ENABLED=false
 *   - "flagsOn":  defaults (both AI features on)
 * Both run with GEMINI_API_KEY / DEEPSEEK_API_KEY blank, so on flagsOn the AI
 * paths degrade through the *provider* "unavailable" route — the gate checks
 * that the kill-switch "unavailable" is a distinct, clearly-worded response and
 * that everything non-AI is untouched.
 *
 *   node scripts/phase28-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = 'C:/Ascend-DataView';
const OFF = 'http://localhost:3161';
const ON = 'http://localhost:3162';
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const PW = 'ascend-gate-K7m2Qp-Zx9';

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
  const r = await c.req('POST', '/api/auth/signup', { body: { email, password: PW, orgName: `P28 ${label} ${s}` } });
  const org = (await r.json()).org;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  await c.req('POST', '/api/auth/login', { body: { email, password: PW } });
  return { c, org };
}

const procs = [];
try {
  await db.initDb();
  procs.push(startBackend(3161, { INSIGHT_ENABLED: 'false', ASCENDAI_ENABLED: 'false' }));
  procs.push(startBackend(3162, {}));
  await waitHealth(OFF);
  await waitHealth(ON);

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
    await db.recordAscendaiUsage(b.org.id, uid, { status: 'seed', promptTokens: 100, completionTokens: 40, totalTokens: 140 });
  }
  const bUsage = await (await b.c.req('GET', '/api/ascendai/usage')).json();
  check('org B usage: today.count includes the seeded turns', bUsage.today.count >= 3, `count=${bUsage.today.count}`);
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

  console.log(`\n${fail === 0 ? 'ALL PHASE 28 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
