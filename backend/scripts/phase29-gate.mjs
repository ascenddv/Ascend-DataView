/**
 * Phase 29 gate — observability & resilience.
 *
 *  - "good" backend (normal DB, DeepSeek pointed at a local stub that returns
 *    HTTP 402): one structured request-log line per request; a 402 from the
 *    provider is logged as the alertable code DEEPSEEK_BALANCE_LOW; no secret
 *    (the session JWT, the provider bearer token) appears anywhere in the logs.
 *  - "bad" backend (bogus DATABASE_URL, started via app.js so it doesn't
 *    migrate on boot): a request that can't reach the DB returns a generic 500
 *    and is logged as ROUTE_5XX with the connection password redacted;
 *    GET /api/health still answers 200 with { db: "down" }.
 *
 *   node scripts/phase29-gate.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = 'C:/Ascend-DataView';
const GOOD = 'http://localhost:3171';
const BAD = 'http://localhost:3172';
const STUB_PORT = 3199;
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const BAD_PG = 'postgresql://baduser:badpass_SEKRIT@127.0.0.1:1/nodb';
const PW = 'ascend-gate-K7m2Qp-Zx9';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(base, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.status) return; } catch { /* */ }
    await sleep(200);
  }
  throw new Error(`${base} never answered`);
}
function capture(proc) {
  const buf = { out: '', err: '' };
  proc.stdout.on('data', (d) => { buf.out += d.toString(); });
  proc.stderr.on('data', (d) => { buf.err += d.toString(); });
  return buf;
}
function makeClient(base) {
  let cookie = null;
  return {
    getCookie: () => cookie,
    async req(m, p, { body } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(base + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, json: async () => r.json().catch(() => null) };
    },
  };
}

const procs = [];
// local stub that always answers /chat/completions with HTTP 402 Insufficient Balance
const stub = createServer((req, res) => {
  res.writeHead(402, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Insufficient Balance', type: 'insufficient_balance' } }));
});
try {
  await new Promise((r) => stub.listen(STUB_PORT, r));
  await db.initDb();

  const good = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env, PORT: '3171', DATABASE_URL: LOCAL_PG,
      HIBP_CHECK_ENABLED: '0', RESEND_API_KEY: '', GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: 'stub-key-DO-NOT-LOG', DEEPSEEK_BASE_URL: `http://localhost:${STUB_PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(good);
  const goodLog = capture(good);

  // bad backend: app.js directly (no migrate-on-boot), pointed at an unreachable DB
  const bad = spawn(process.execPath, ['-e', "require('./app').listen(process.env.PORT)"], {
    cwd: `${ROOT}/backend`,
    env: { ...process.env, PORT: '3172', DATABASE_URL: BAD_PG, HIBP_CHECK_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(bad);
  const badLog = capture(bad);

  await waitHealth(GOOD);
  await waitHealth(BAD);

  /* ============================================================ */
  console.log('\n== 1. structured request logging, no secrets in the logs ==');
  const c = makeClient(GOOD);
  const s = Date.now();
  await c.req('POST', '/api/auth/signup', { body: { email: `p29_${s}@t.co`, password: PW, orgName: `P29 ${s}` } });
  const orgRow = await db.getDb().query('SELECT id FROM organizations WHERE name = $1', [`P29 ${s}`]);
  const orgId = orgRow.rows[0].id;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [orgId]);
  await c.req('POST', '/api/auth/login', { body: { email: `p29_${s}@t.co`, password: PW } });
  await c.req('GET', '/api/data');
  await sleep(200);

  const reqLines = goodLog.out.split('\n').filter((l) => l.includes('"kind":"request"')).map((l) => JSON.parse(l));
  const dataLine = reqLines.find((l) => l.path === '/api/data' && l.method === 'GET');
  check('a JSON request line is emitted per request (method, path, status, ms, orgId)',
    dataLine && dataLine.status === 200 && typeof dataLine.ms === 'number' && dataLine.orgId === orgId,
    JSON.stringify(dataLine));

  const jwt = (c.getCookie() || '').split('=')[1] || 'NO_COOKIE';
  const allGood = goodLog.out + goodLog.err;
  check('the session JWT never appears in the logs', jwt.length > 20 && !allGood.includes(jwt));
  check('the DeepSeek bearer key never appears in the logs', !allGood.includes('stub-key-DO-NOT-LOG'));

  /* ============================================================ */
  console.log('\n== 2. a DeepSeek 402 is logged as DEEPSEEK_BALANCE_LOW ==');
  await db.getDb().query('DELETE FROM rate_limits');
  const chat = await c.req('POST', '/api/ascendai/chat', { body: { message: 'how am I doing?' } });
  const chatBody = await chat.json();
  check('the chat turn degrades cleanly (200 unavailable), not a 500',
    chat.status === 200 && chatBody.status === 'unavailable');
  await sleep(300);
  const balanceSignal = goodLog.err.split('\n').filter((l) => l.includes('DEEPSEEK_BALANCE_LOW')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find(Boolean);
  check('DEEPSEEK_BALANCE_LOW signal line written to stderr with the org id',
    balanceSignal && balanceSignal.code === 'DEEPSEEK_BALANCE_LOW' && balanceSignal.orgId === orgId,
    JSON.stringify(balanceSignal));

  /* ============================================================ */
  console.log('\n== 3. an unreachable DB -> generic 500 logged as ROUTE_5XX, password redacted ==');
  const badReq = await fetch(`${BAD}/api/auth/me`);
  const badBody = await badReq.json().catch(() => null);
  check('request that needs the DB -> 500 with a generic message (no stack, no DSN)',
    badReq.status === 500 && badBody && badBody.ok === false && /something went wrong/i.test(badBody.error || '') && !/(badpass|127\.0\.0\.1:1)/.test(JSON.stringify(badBody)),
    `${badReq.status} ${JSON.stringify(badBody)}`);
  await sleep(200);
  check('a ROUTE_5XX error line was written',
    badLog.err.split('\n').some((l) => l.includes('"code":"ROUTE_5XX"')));
  check('the connection password is NOT in any log line',
    !badLog.err.includes('badpass_SEKRIT') && !badLog.out.includes('badpass_SEKRIT'));

  /* ============================================================ */
  console.log('\n== 4. GET /api/health reports the DB probe ==');
  const hGood = await (await fetch(`${GOOD}/api/health`)).json();
  check('healthy backend -> { status: "ok", db: "ok" }', hGood.status === 'ok' && hGood.db === 'ok', JSON.stringify(hGood));
  const hBad = await fetch(`${BAD}/api/health`);
  const hBadBody = await hBad.json();
  check('DB-less backend -> 200 with { db: "down" } (still reachable for monitors)',
    hBad.status === 200 && hBadBody.db === 'down', `${hBad.status} ${JSON.stringify(hBadBody)}`);

  console.log(`\n${fail === 0 ? 'ALL PHASE 29 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  stub.close();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
