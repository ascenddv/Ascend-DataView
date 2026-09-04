/**
 * Phase 24 gate — revocable sessions.
 *
 * Two backend processes, one Postgres (the local stand-in for Vercel routing
 * consecutive requests to different lambdas). A session established on instance A
 * must stop working on instance B the moment the user signs out everywhere —
 * the check is a shared users.token_version, not per-process state.
 *
 *   node scripts/phase24-gate.mjs
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const A = 'http://localhost:3121';
const B = 'http://localhost:3122';
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
    env: { ...process.env, PORT: String(port), DATABASE_URL: LOCAL_PG, HIBP_CHECK_ENABLED: '0', ...extraEnv },
    stdio: 'ignore',
  });
}
function makeClient(base) {
  let cookie = null;
  return {
    base,
    getCookie: () => cookie,
    setCookie: (c) => { cookie = c; },
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
async function signup(client, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const email = `p24_${label}_${s}@t.co`;
  const password = 'ascend-gate-K7m2Qp-Zx9';
  const r = await client.req('POST', '/api/auth/signup', {
    body: { email, password, orgName: `P24 ${label} ${s}`, acceptTos: true },
  });
  return { email, password, org: (await r.json()).org, status: r.status };
}
const tokenVersion = async (orgId) => {
  const { rows } = await db.getDb().query(
    'SELECT token_version FROM users WHERE org_id = $1 ORDER BY id LIMIT 1', [orgId]
  );
  return rows[0].token_version;
};

const procs = [];
try {
  await db.initDb(); // applies 003_token_version up front

  procs.push(startBackend(3121));
  await waitHealth(A);
  procs.push(startBackend(3122, { VERCEL: '1' }));
  await waitHealth(B);

  const ca = makeClient(A);
  const cb = makeClient(B);

  /* ============================================================ */
  console.log('\n== 1. logout-all on A revokes the same session on B ==');
  const u = await signup(ca, 'main');
  cb.setCookie(ca.getCookie()); // same signed session, now also used against B
  check('the new session works on instance A', (await ca.req('GET', '/api/data')).status === 200);
  check('the same cookie works on instance B', (await cb.req('GET', '/api/data')).status === 200);
  check('token_version starts at 0', (await tokenVersion(u.org.id)) === 0);

  const lo = await ca.req('POST', '/api/auth/logout-all');
  check('POST /api/auth/logout-all -> 200', lo.status === 200);
  check('token_version was bumped to 1', (await tokenVersion(u.org.id)) === 1);

  const bAfter = await cb.req('GET', '/api/data');
  check('instance B rejects the now-stale token on its next request (401)', bAfter.status === 401,
    `-> ${bAfter.status}`);
  check('the 401 explains the session was signed out',
    /signed out/i.test((await (await fetch(B + '/api/data', { headers: { Cookie: cb.getCookie() || 'x=y' } })).json()).error || ''));

  cb.setCookie(ca.getCookie()); // ca's cookie was cleared by logout-all; re-copy the dead one
  const meAfter = await cb.req('GET', '/api/auth/me');
  check('GET /api/auth/me with the stale cookie -> authenticated:false',
    (await meAfter.json())?.authenticated === false);

  /* ============================================================ */
  console.log('\n== 2. a fresh login after logout-all works normally ==');
  const relog = await ca.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
  check('re-login -> 200', relog.status === 200);
  check('the fresh session works on A', (await ca.req('GET', '/api/data')).status === 200);
  cb.setCookie(ca.getCookie());
  check('and on B', (await cb.req('GET', '/api/data')).status === 200);
  check('the fresh token is minted at token_version 1 (no second bump)', (await tokenVersion(u.org.id)) === 1);

  /* ============================================================ */
  console.log('\n== 3. plain logout is this-browser-only (no token_version bump) ==');
  const u2 = await signup(ca, 'plain');
  cb.setCookie(ca.getCookie());
  check('u2 session works on B', (await cb.req('GET', '/api/data')).status === 200);
  await ca.req('POST', '/api/auth/logout');
  check('u2 token_version is still 0 after a plain logout', (await tokenVersion(u2.org.id)) === 0);
  check('the other browser (instance B, same old cookie) still works',
    (await cb.req('GET', '/api/data')).status === 200);

  /* ============================================================ */
  console.log('\n== 4. logout-all requires a session ==');
  const anon = makeClient(A);
  check('POST /api/auth/logout-all with no cookie -> 401', (await anon.req('POST', '/api/auth/logout-all')).status === 401);

  console.log(`\n${fail === 0 ? 'ALL PHASE 24 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
