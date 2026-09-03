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

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = 'C:/Ascend-DataView';
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
      ...process.env, PORT: '3182', DATABASE_URL: LOCAL_PG,
      VERCEL: '1', JWT_SECRET: '', CORS_ORIGINS: '', RESEND_API_KEY: '',
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
  check('the banner names the missing vars (JWT_SECRET, CORS_ORIGINS, RESEND_API_KEY)',
    /MISSING: JWT_SECRET/.test(badErr) && /MISSING: CORS_ORIGINS/.test(badErr) && /MISSING: RESEND_API_KEY/.test(badErr),
    badErr.split('\n').filter((l) => /MISSING/.test(l)).join(' | '));
  const configSignal = badErr.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && o.code === 'CONFIG_GUARD');
  check('a CONFIG_GUARD signal line was emitted', configSignal && Array.isArray(configSignal.missing));
  const h = await fetch(`${BAD}/api/health`);
  check('the misconfigured backend still serves /api/health with HTTP 200', h.status === 200, `-> ${h.status}`);

  console.log(`\n${fail === 0 ? 'ALL PHASE 30 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
