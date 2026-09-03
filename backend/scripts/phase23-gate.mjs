/**
 * Phase 23 gate — rate limiting on the expensive endpoints.
 *
 * Every LLM / PDF / parse endpoint now has its own DB-backed limiter, keyed per
 * org+user and shared across serverless instances. This drives each one across
 * TWO backend processes on ONE Postgres (the local stand-in for Vercel routing
 * consecutive requests to different lambdas) and asserts:
 *   - normal usage is never limited
 *   - each limit fires exactly at its threshold, with the right response shape
 *   - the count is shared: the request that trips the limit does so on an
 *     instance that served only ~half of the attempts
 *   - the chat burst limit is a friendly { status:'rate_limited' }, not a 429,
 *     and a burst-limited turn never reaches the provider or the daily counter
 *   - the fixed window actually RESETS: after windowMs elapses the counter goes
 *     back to 1 and requests are allowed again (real HTTP -> real PgRateStore SQL)
 *
 * GEMINI_API_KEY / DEEPSEEK_API_KEY are blanked for the spawned backends so
 * /api/insight and /api/ascendai/chat degrade instantly with no external call
 * or cost — the limiter still counts every attempt.
 *
 *   node scripts/phase23-gate.mjs
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { PgRateStore } = require('../services/pgRateStore');
const {
  INSIGHT_RATE_LIMIT,
  PDF_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  ASCENDAI_CHAT_BURST_LIMIT,
} = require('../config/thresholds');

const ROOT = 'C:/Ascend-DataView';
const A = 'http://localhost:3111';
const B = 'http://localhost:3112';
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(base, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error(`${base} never became healthy`);
}
function startBackend(port, extraEnv = {}) {
  return spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: LOCAL_PG,
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      HIBP_CHECK_ENABLED: '0', // keep signups offline / fast
      ...extraEnv,
    },
    stdio: 'ignore',
  });
}

function makeClient(base) {
  let cookie = null;
  return {
    base,
    getCookie: () => cookie,
    setCookie: (c) => { cookie = c; },
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const r = await fetch(base + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return {
        status: r.status,
        headers: r.headers,
        json: async () => r.json().catch(() => null),
        buf: async () => Buffer.from(await r.arrayBuffer()),
      };
    },
  };
}

async function signup(client, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await client.req('POST', '/api/auth/signup', {
    body: { email: `p23_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P23 ${label} ${s}`, acceptTos: true },
  });
  const org = (await r.json()).org;
  // Phase 25: upload / chat now require a verified email — mark it verified so
  // this gate stays about rate limiting.
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  return org;
}
const startOfUtcDayIso = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
const peakHits = async (prefix) => {
  const { rows } = await db.getDb().query(
    "SELECT COALESCE(max(hits), 0) AS peak FROM rate_limits WHERE key LIKE $1",
    [`${prefix}%`]
  );
  return Number(rows[0].peak);
};

const procs = [];
try {
  await db.initDb();
  await db.getDb().query('DELETE FROM rate_limits');

  procs.push(startBackend(3111));
  await waitHealth(A);
  procs.push(startBackend(3112, { VERCEL: '1' }));
  await waitHealth(B);

  const ca = makeClient(A);
  const cb = makeClient(B);

  /* ============================================================ */
  console.log('\n== 0. a normal amount of activity is never limited ==');
  const orgN = await signup(ca, 'normal');
  cb.setCookie(ca.getCookie());
  let anyLimited = false;
  for (let i = 0; i < 5; i += 1) {
    const c = i % 2 === 0 ? ca : cb;
    const ins = await c.req('GET', '/api/insight');
    const pdf = await c.req('GET', '/api/report.pdf');
    if (ins.status === 429 || pdf.status === 429) anyLimited = true;
  }
  for (let i = 0; i < 3; i += 1) {
    const chat = await cb.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
    const cj = await chat.json();
    if (cj && cj.status === 'rate_limited') anyLimited = true;
  }
  check('5 insight + 5 pdf + 3 chat turns for a fresh org: none limited', !anyLimited);
  check('org "normal" has no rate_limits rows near any ceiling',
    (await peakHits('insight:')) <= 5 && (await peakHits('pdf:')) <= 5);

  /* ============================================================ */
  console.log(`\n== 1. GET /api/insight: hard 429 at ${INSIGHT_RATE_LIMIT}, shared across A/B ==`);
  await db.getDb().query('DELETE FROM rate_limits');
  const orgA = await signup(ca, 'insight');
  cb.setCookie(ca.getCookie());
  const insStatuses = [];
  for (let i = 0; i < INSIGHT_RATE_LIMIT + 1; i += 1) {
    const c = i % 2 === 0 ? ca : cb;
    const r = await c.req('GET', '/api/insight');
    insStatuses.push({ i, inst: i % 2 === 0 ? 'A' : 'B', status: r.status, body: await r.json() });
  }
  const firstN = insStatuses.slice(0, INSIGHT_RATE_LIMIT);
  const tripped = insStatuses[INSIGHT_RATE_LIMIT];
  check(`first ${INSIGHT_RATE_LIMIT} are not 429`, firstN.every((r) => r.status !== 429),
    firstN.map((r) => `${r.inst}:${r.status}`).join(' '));
  check(`attempt ${INSIGHT_RATE_LIMIT + 1} -> 429 { ok:false, error }`,
    tripped.status === 429 && tripped.body && tripped.body.ok === false && /too many/i.test(tripped.body.error || ''),
    `on instance ${tripped.inst}: ${tripped.status} ${JSON.stringify(tripped.body)}`);
  check('the shared insight: counter saw every attempt (not ~half)',
    (await peakHits('insight:')) >= INSIGHT_RATE_LIMIT + 1, `peak=${await peakHits('insight:')}`);

  /* ============================================================ */
  console.log(`\n== 2. GET /api/report.pdf: hard 429 at ${PDF_RATE_LIMIT}, shared across A/B ==`);
  await db.getDb().query('DELETE FROM rate_limits');
  const orgP = await signup(ca, 'pdf');
  cb.setCookie(ca.getCookie());
  const pdfStatuses = [];
  for (let i = 0; i < PDF_RATE_LIMIT + 1; i += 1) {
    const c = i % 2 === 0 ? ca : cb;
    const r = await c.req('GET', '/api/report.pdf');
    pdfStatuses.push({ inst: i % 2 === 0 ? 'A' : 'B', status: r.status });
  }
  check(`first ${PDF_RATE_LIMIT} PDF requests are not 429`,
    pdfStatuses.slice(0, PDF_RATE_LIMIT).every((r) => r.status === 200),
    pdfStatuses.slice(0, PDF_RATE_LIMIT).map((r) => `${r.inst}:${r.status}`).join(' '));
  check(`PDF request ${PDF_RATE_LIMIT + 1} -> 429`, pdfStatuses[PDF_RATE_LIMIT].status === 429,
    `on ${pdfStatuses[PDF_RATE_LIMIT].inst} -> ${pdfStatuses[PDF_RATE_LIMIT].status}`);

  /* ============================================================ */
  console.log(`\n== 3. /api/upload + /api/upload/confirm share one ${UPLOAD_RATE_LIMIT}-req limit ==`);
  await db.getDb().query('DELETE FROM rate_limits');
  const orgU = await signup(ca, 'upload');
  cb.setCookie(ca.getCookie());
  const upStatuses = [];
  for (let i = 0; i < UPLOAD_RATE_LIMIT + 1; i += 1) {
    const c = i % 2 === 0 ? ca : cb;
    // alternate the two endpoints; neither has a file / a real pending id, so
    // each is a fast 400 / 404 — but the limiter counts it either way.
    const r = i % 2 === 0
      ? await c.req('POST', '/api/upload', { body: {} })
      : await c.req('POST', '/api/upload/confirm', { body: { pendingId: 'nope' } });
    upStatuses.push(r.status);
  }
  check(`first ${UPLOAD_RATE_LIMIT} upload/confirm calls are not 429`,
    upStatuses.slice(0, UPLOAD_RATE_LIMIT).every((s) => s !== 429),
    [...new Set(upStatuses.slice(0, UPLOAD_RATE_LIMIT))].join(','));
  check(`combined attempt ${UPLOAD_RATE_LIMIT + 1} -> 429`, upStatuses[UPLOAD_RATE_LIMIT] === 429,
    `-> ${upStatuses[UPLOAD_RATE_LIMIT]}`);

  /* ============================================================ */
  console.log(`\n== 4. POST /api/ascendai/chat burst: ${ASCENDAI_CHAT_BURST_LIMIT}/min, friendly (not 429) ==`);
  await db.getDb().query('DELETE FROM rate_limits');
  const orgC = await signup(ca, 'chat');
  cb.setCookie(ca.getCookie());
  const chatResults = [];
  for (let i = 0; i < ASCENDAI_CHAT_BURST_LIMIT + 1; i += 1) {
    const c = i % 2 === 0 ? ca : cb;
    const r = await c.req('POST', '/api/ascendai/chat', { body: { message: `q${i}` } });
    chatResults.push({ status: r.status, body: await r.json() });
  }
  const preBurst = chatResults.slice(0, ASCENDAI_CHAT_BURST_LIMIT);
  const burst = chatResults[ASCENDAI_CHAT_BURST_LIMIT];
  check(`first ${ASCENDAI_CHAT_BURST_LIMIT} turns reach the route (HTTP 200, status "unavailable")`,
    preBurst.every((r) => r.status === 200 && r.body && r.body.status === 'unavailable'),
    preBurst.map((r) => `${r.status}/${r.body && r.body.status}`).join(' '));
  check(`turn ${ASCENDAI_CHAT_BURST_LIMIT + 1} is a friendly 200 { status:"rate_limited" }, NOT a 429`,
    burst.status === 200 && burst.body && burst.body.ok === true && burst.body.status === 'rate_limited',
    `${burst.status} ${JSON.stringify(burst.body && burst.body.status)}`);
  check('the burst reply names the per-minute burst limit (distinct from the daily cap)',
    burst.body && /burst limit/i.test(burst.body.reason || '') && !/daily/i.test(burst.body.reason || ''),
    JSON.stringify(burst.body && burst.body.reason));
  const usedToday = await db.countAscendaiUsageSince(orgC.id, startOfUtcDayIso());
  check(`the burst-limited turn never reached the provider or the daily counter (usage = ${ASCENDAI_CHAT_BURST_LIMIT})`,
    usedToday === ASCENDAI_CHAT_BURST_LIMIT, `ascendai_usage rows today = ${usedToday}`);

  /* ============================================================ */
  console.log('\n== 5. the fixed window RESETS after windowMs (real HTTP -> real PgRateStore SQL) ==');
  await db.getDb().query("DELETE FROM rate_limits WHERE key LIKE 'wintest:%'");
  const WIN_MS = 2000;
  const winApp = express();
  const winLimiter = rateLimit({
    windowMs: WIN_MS,
    limit: 2,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: () => 'k',
    validate: { keyGeneratorIpFallback: false },
    store: new PgRateStore({ prefix: 'wintest:' }),
    handler: (_req, res) => res.status(429).json({ ok: false }),
  });
  winApp.get('/probe', winLimiter, (_req, res) => res.json({ ok: true }));
  const winServer = winApp.listen(3113);
  const hitProbe = async () => (await fetch('http://localhost:3113/probe')).status;
  try {
    const s1 = await hitProbe();
    const s2 = await hitProbe();
    const s3 = await hitProbe();
    check('within the 2s window: first 2 -> 200, 3rd -> 429', s1 === 200 && s2 === 200 && s3 === 429,
      `${s1} ${s2} ${s3}`);
    const rowMid = (await db.getDb().query("SELECT hits FROM rate_limits WHERE key = 'wintest:k'")).rows[0];
    check('the shared row shows 3 hits mid-window', Number(rowMid.hits) === 3, `hits=${rowMid && rowMid.hits}`);

    await sleep(WIN_MS + 300); // let expires_at pass now()

    const s4 = await hitProbe();
    check('after the window elapses: the next request is allowed again (200)', s4 === 200, `-> ${s4}`);
    const rowAfter = (await db.getDb().query("SELECT hits FROM rate_limits WHERE key = 'wintest:k'")).rows[0];
    check('the counter reset to 1 (CASE WHEN expires_at <= now() THEN 1 branch fired)',
      Number(rowAfter.hits) === 1, `hits=${rowAfter && rowAfter.hits}`);
    const s5 = await hitProbe();
    const s6 = await hitProbe();
    check('and the fresh window enforces the ceiling again (3rd of the new window -> 429)', s5 === 200 && s6 === 429,
      `${s4} ${s5} ${s6}`);
  } finally {
    winServer.close();
    await db.getDb().query("DELETE FROM rate_limits WHERE key LIKE 'wintest:%'").catch(() => {});
  }

  console.log(`\n${fail === 0 ? 'ALL PHASE 23 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.getDb().query('DELETE FROM rate_limits').catch(() => {});
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
