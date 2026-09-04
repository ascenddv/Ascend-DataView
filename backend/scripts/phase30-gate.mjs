/**
 * Phase 30 gate — signup ToS consent + the production config guard.
 *
 *  - "app": a normal backend. Signup is rejected without the ToS checkbox and
 *    accepted with it (users.tos_accepted_at then stamped); an invited user is
 *    stamped on accept.
 *  - "misconfigured": a backend booted via app.js in a prod-like env (VERCEL=1)
 *    with JWT_SECRET / CORS_ORIGINS / RESEND_API_KEY blank — the loud
 *    PRODUCTION CONFIG PROBLEM banner + CONFIG_GUARD signal must appear on
 *    stderr, and /api/health must still answer 200.
 *
 *   node scripts/phase30-gate.mjs
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const APP = 'http://localhost:3181';
const BAD = 'http://localhost:3182';
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
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
const post = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let stdout = '';
async function waitForToken(kind, tries = 40) {
  const re = new RegExp(`/${kind}\\?token=([0-9a-f]{64})`);
  for (let i = 0; i < tries; i += 1) {
    const m = stdout.match(re);
    if (m) return m[1];
    await sleep(100);
  }
  throw new Error(`no ${kind} link on the log`);
}

const procs = [];
try {
  await db.initDb();

  const app = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: { ...process.env, PORT: '3181', DATABASE_URL: LOCAL_PG, HIBP_CHECK_ENABLED: '0', RESEND_API_KEY: '', APP_BASE_URL: APP, GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(app);
  app.stdout.on('data', (d) => { stdout += d.toString(); });
  app.stderr.on('data', () => {});

  const bad = spawn(process.execPath, ['-e', "require('./app').listen(process.env.PORT)"], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env, PORT: '3182', DATABASE_URL: LOCAL_PG, HIBP_CHECK_ENABLED: '0',
      VERCEL: '1', JWT_SECRET: '', CORS_ORIGINS: '', RESEND_API_KEY: '',
      APP_BASE_URL: '', EMAIL_FROM: '', CRON_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(bad);
  let badErr = '';
  bad.stderr.on('data', (d) => { badErr += d.toString(); });
  bad.stdout.on('data', () => {});

  await waitHealth(APP);
  await waitHealth(BAD);

  /* ============================================================ */
  console.log('\n== 1. signup requires the ToS checkbox ==');
  const s = Date.now();
  const noBox = await post(APP, '/api/auth/signup', { email: `p30_${s}@t.co`, password: PW, orgName: `P30 ${s}` });
  check('signup without acceptTos -> 400, message names the Terms',
    noBox.status === 400 && /terms of service/i.test((await noBox.json()).error || ''), `-> ${noBox.status}`);

  const withBox = await post(APP, '/api/auth/signup', { email: `p30_${s}@t.co`, password: PW, orgName: `P30 ${s}`, acceptTos: true });
  check('signup with acceptTos:true -> 201', withBox.status === 201, `-> ${withBox.status}`);
  const orgId = (await withBox.json()).org.id;
  const owner = (await db.getDb().query('SELECT tos_accepted_at FROM users WHERE org_id = $1', [orgId])).rows[0];
  check('users.tos_accepted_at is stamped for the signing owner', owner.tos_accepted_at != null);

  // invited user is stamped on accept
  await db.getDb().query('DELETE FROM rate_limits');
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [orgId]);
  const login = await post(APP, '/api/auth/login', { email: `p30_${s}@t.co`, password: PW });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  await fetch(`${APP}/api/organizations/${orgId}/invitations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ email: `p30_inv_${s}@t.co` }),
  });
  const itoken = await waitForToken('accept-invite');
  await post(APP, '/api/auth/accept-invite', { token: itoken, password: PW });
  const invitee = (await db.getDb().query(
    "SELECT tos_accepted_at FROM users WHERE org_id = $1 AND role = 'member'", [orgId]
  )).rows[0];
  check('an invited user is stamped tos_accepted_at on accept', invitee && invitee.tos_accepted_at != null);

  /* ============================================================ */
  console.log('\n== 2. the production config guard is loud, health stays up ==');
  await sleep(300);
  check('a "PRODUCTION CONFIG PROBLEM" banner was printed to stderr on boot',
    /PRODUCTION CONFIG PROBLEM/.test(badErr));
  check('the banner names the classic missing vars (JWT_SECRET, CORS_ORIGINS, RESEND_API_KEY)',
    /MISSING: JWT_SECRET/.test(badErr) && /MISSING: CORS_ORIGINS/.test(badErr) && /MISSING: RESEND_API_KEY/.test(badErr),
    badErr.split('\n').filter((l) => /MISSING/.test(l)).join(' | '));
  // Phase 30 audit: these three were previously invisible to the guard — a
  // deploy missing them (broken email links, a cron that silently never runs)
  // would have been reported "config is fine".
  check('the guard now ALSO catches APP_BASE_URL, EMAIL_FROM and CRON_SECRET',
    /MISSING: APP_BASE_URL/.test(badErr) && /MISSING: EMAIL_FROM/.test(badErr) && /MISSING: CRON_SECRET/.test(badErr),
    badErr.split('\n').filter((l) => /MISSING/.test(l)).join(' | '));
  const configSignal = badErr.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && o.code === 'CONFIG_GUARD');
  check('a CONFIG_GUARD signal line was emitted, listing every missing var',
    configSignal && Array.isArray(configSignal.missing) &&
    ['JWT_SECRET', 'CORS_ORIGINS', 'RESEND_API_KEY', 'APP_BASE_URL', 'EMAIL_FROM', 'CRON_SECRET']
      .every((v) => configSignal.missing.includes(v)),
    configSignal ? configSignal.missing.join(',') : 'no signal');
  const h = await fetch(`${BAD}/api/health`);
  check('the misconfigured backend still serves /api/health with HTTP 200', h.status === 200, `-> ${h.status}`);

  /* ============================================================ */
  console.log('\n== 3. a route that needs the missing JWT_SECRET returns a handled 500, not a crash ==');
  await db.getDb().query('DELETE FROM rate_limits');
  // p30_<s> was created + verified on the APP instance in §1; both instances
  // share one DB. Login gets past getUserByEmail/verifyPassword, then
  // setSession -> signToken -> jwtSecret() throws on the JWT_SECRET-less BAD
  // instance. That throw must land in the app.js error handler.
  const beforeLen = badErr.length;
  const boom = await post(BAD, '/api/auth/login', { email: `p30_${s}@t.co`, password: PW });
  const boomBody = await boom.json().catch(() => null);
  check('the auth route -> HTTP 500 (handled, not a socket hang-up)', boom.status === 500, `-> ${boom.status}`);
  check('the 500 body is the generic error handler message, no stack / no detail',
    boomBody && boomBody.ok === false && boomBody.error === 'Something went wrong. Please try again.',
    JSON.stringify(boomBody));
  await sleep(150);
  const newErr = badErr.slice(beforeLen);
  const route5xx = newErr.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && o.code === 'ROUTE_5XX');
  check('the throw went through the ROUTE_5XX capture path (error handler ran)',
    Boolean(route5xx) || /ROUTE_5XX/.test(newErr), newErr.split('\n').find((l) => /ROUTE_5XX|Error/.test(l)) || '(nothing)');
  const h2 = await fetch(`${BAD}/api/health`);
  check('the BAD instance is still alive after the throw (process did not exit)', h2.status === 200, `-> ${h2.status}`);

  console.log(`\n${fail === 0 ? 'ALL PHASE 30 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
