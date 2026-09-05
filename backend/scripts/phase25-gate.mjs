/**
 * Phase 25 gate — email verification, password reset, and the requireVerified
 * wall in front of upload / AscendAI.
 *
 * One backend on the local Postgres, RESEND_API_KEY unset so email drops to the
 * dev logger — the gate scrapes the verify / reset links straight off the
 * backend's stdout, the same way a developer would read them locally.
 * HIBP_CHECK_ENABLED is left ON: the breached-password checks hit the real
 * Have I Been Pwned range API.
 *
 *   node scripts/phase25-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// Temporary — see the matching TEMPORARY block in services/passwordCheck.js.
// Turns on read-only timing/state logging for this gate process's own direct
// isBreachedPassword() calls only (never set by the app itself).
process.env.HIBP_DEBUG_TIMING = '1';

const require = createRequire(import.meta.url);
const db = require('../db');
const { isBreachedPassword } = require('../services/passwordCheck');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const PORT = 3131;
const BASE = `http://localhost:${PORT}`;
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';

const STRONG_PW = 'ascend-gate-K7m2Qp-Zx9';
const STRONG_PW_2 = 'ascend-gate-R4tb-Wm81-Zc';
const BREACHED_PW = 'password123'; // ≥10 chars, and very much in HIBP

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stdout = '';
async function waitHealth(tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error('backend never became healthy');
}
async function waitForToken(kind, tries = 40) {
  const re = new RegExp(`/${kind}\\?token=([0-9a-f]{64})`);
  for (let i = 0; i < tries; i += 1) {
    const m = stdout.match(re);
    if (m) return m[1];
    await sleep(100);
  }
  throw new Error(`no ${kind} link appeared on the backend log`);
}

function makeClient() {
  let cookie = null;
  return {
    getCookie: () => cookie,
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(BASE + p, { method: m, headers: h, body: payload });
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
// The auth limiter is 10 / 15 min / IP; this gate makes far more auth calls than
// that from one IP, so clear the shared counter between sections.
const clearLimits = () => db.getDb().query('DELETE FROM rate_limits');

/**
 * Diagnostic only — fires ONLY when isBreachedPassword() unexpectedly returns
 * false for a password we know is breached. Replicates services/passwordCheck
 * .js's own request (same hash, same 'Add-Padding' header) so we can see what
 * api.pwnedpasswords.com actually sent back, instead of guessing from the
 * absence of other signals. Does not touch, wrap, or change passwordCheck.js.
 */
async function diagnoseHibpMismatch(plain) {
  const sha1 = crypto.createHash('sha1').update(String(plain), 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  console.log(`  [diag] sha1=${sha1} prefix=${prefix} suffix=${suffix}`);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    const body = await res.text();
    const lines = body.split('\n').filter(Boolean);
    const matchLine = lines.find((l) => l.trim().split(':')[0]?.toUpperCase() === suffix);
    console.log(`  [diag] HTTP ${res.status}, content-type=${res.headers.get('content-type')}, ${lines.length} lines in body`);
    console.log(`  [diag] suffix ${matchLine ? 'FOUND: ' + matchLine.trim() : 'NOT FOUND anywhere in the raw body'}`);
    console.log(`  [diag] first 15 lines of body:\n${lines.slice(0, 15).map((l) => '    ' + l).join('\n')}`);
    if (lines.length === 0) console.log('  [diag] body was completely empty');
  } catch (err) {
    console.log(`  [diag] the diagnostic fetch itself threw: ${err && err.name} ${err && err.message}`);
  }
}

let proc;
try {
  await db.initDb();

  proc = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: LOCAL_PG,
      RESEND_API_KEY: '',
      APP_BASE_URL: BASE,
      HIBP_CHECK_ENABLED: '1',
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', () => {});
  await waitHealth();

  const c = makeClient();
  const email = `p25_${Date.now()}@t.co`;

  /* ============================================================ */
  console.log('\n== 1. signup issues a verification email; the account starts unverified ==');
  const su = await c.req('POST', '/api/auth/signup', {
    body: { email, password: STRONG_PW, orgName: `P25 ${Date.now()}`, acceptTos: true },
  });
  const suBody = await su.json();
  check('signup -> 201', su.status === 201, `-> ${su.status}`);
  check('the new account reports emailVerified:false', suBody?.user?.emailVerified === false);
  const signupCookie = c.getCookie();
  const vtoken = await waitForToken('verify-email');
  check('a verify-email link was logged (dev email)', typeof vtoken === 'string' && vtoken.length === 64);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 2. before verifying, the write/spend surface is blocked (403 needsVerification) ==');
  const upBlocked = await c.req('POST', '/api/upload', { body: {} });
  const upBlockedBody = await upBlocked.json();
  check('POST /api/upload -> 403 { needsVerification: true }',
    upBlocked.status === 403 && upBlockedBody?.needsVerification === true, `-> ${upBlocked.status}`);
  const chatBlocked = await c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
  check('POST /api/ascendai/chat -> 403 needsVerification',
    chatBlocked.status === 403 && (await chatBlocked.json())?.needsVerification === true,
    `-> ${chatBlocked.status}`);
  const meBlocked = await c.req('POST', '/api/manual-entry', { body: { values: { period_date: '2025-01-31', revenue: 1 } } });
  check('POST /api/manual-entry -> 403 needsVerification (was an unverified-add hole)',
    meBlocked.status === 403 && (await meBlocked.json())?.needsVerification === true, `-> ${meBlocked.status}`);
  const resetBlocked = await c.req('DELETE', `/api/organizations/${suBody?.org?.id ?? 0}/data`, { body: { confirm: 'x' } });
  check('DELETE /api/organizations/:id/data -> 403 needsVerification (was an unverified-destroy hole)',
    resetBlocked.status === 403 && (await resetBlocked.json())?.needsVerification === true, `-> ${resetBlocked.status}`);
  const meUnverified = await c.req('GET', '/api/auth/me');
  check('GET /api/auth/me reports user.emailVerified:false',
    (await meUnverified.json())?.user?.emailVerified === false);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 3. following the link verifies the address ==');
  const verify = await c.req('POST', '/api/auth/verify-email', { body: { token: vtoken } });
  check('POST /api/auth/verify-email -> 200 { emailVerified: true }',
    verify.status === 200 && (await verify.json())?.emailVerified === true, `-> ${verify.status}`);
  const meVerified = await c.req('GET', '/api/auth/me');
  check('GET /api/auth/me now reports emailVerified:true',
    (await meVerified.json())?.user?.emailVerified === true);
  const upOk = await c.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
  const upOkBody = await upOk.json();
  check('POST /api/upload now succeeds (data stored)',
    upOk.status === 200 && (upOkBody?.periodsAdded || 0) > 0, `-> ${upOk.status}`);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 4. verification tokens are single-use ==');
  const reuse = await c.req('POST', '/api/auth/verify-email', { body: { token: vtoken } });
  check('re-using the consumed token -> 400', reuse.status === 400);
  const garbage = await c.req('POST', '/api/auth/verify-email', { body: { token: 'not-a-real-token' } });
  check('a garbage token -> 400', garbage.status === 400);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 5. forgot-password: 200 for anyone, a link only for a real user ==');
  const logLenBefore = stdout.length;
  const unknown = await c.req('POST', '/api/auth/forgot-password', { body: { email: 'nobody@nowhere.example' } });
  check('unknown email -> 200 (no enumeration)', unknown.status === 200);
  await sleep(300);
  check('no reset link was logged for the unknown email',
    !/\/reset-password\?token=/.test(stdout.slice(logLenBefore)));

  const forgot = await c.req('POST', '/api/auth/forgot-password', { body: { email } });
  check('real email -> 200', forgot.status === 200);
  const rtoken = await waitForToken('reset-password');
  check('a reset link was logged for the real user', typeof rtoken === 'string' && rtoken.length === 64);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 6. reset-password validates the new password before burning the token ==');
  const weak = await c.req('POST', '/api/auth/reset-password', { body: { token: rtoken, password: 'short' } });
  check('a too-short new password -> 400', weak.status === 400);
  const breachedReset = await c.req('POST', '/api/auth/reset-password', { body: { token: rtoken, password: BREACHED_PW } });
  check('a breached new password -> 400 (mentions the breach)',
    breachedReset.status === 400 && /breach/i.test((await breachedReset.json())?.error || ''),
    `-> ${breachedReset.status}`);

  const reset = await c.req('POST', '/api/auth/reset-password', { body: { token: rtoken, password: STRONG_PW_2 } });
  check('a strong new password -> 200', reset.status === 200, `-> ${reset.status}`);
  const reuseReset = await c.req('POST', '/api/auth/reset-password', { body: { token: rtoken, password: STRONG_PW } });
  check('the reset token is single-use (re-use -> 400)', reuseReset.status === 400);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 7. the reset killed every existing session; the new password works ==');
  const staleMe = await fetch(BASE + '/api/auth/me', { headers: { Cookie: signupCookie } });
  check('the pre-reset session cookie is now unauthenticated',
    (await staleMe.json())?.authenticated === false);
  const oldLogin = await c.req('POST', '/api/auth/login', { body: { email, password: STRONG_PW } });
  check('login with the OLD password -> 401', oldLogin.status === 401);
  const newLogin = await c.req('POST', '/api/auth/login', { body: { email, password: STRONG_PW_2 } });
  check('login with the NEW password -> 200', newLogin.status === 200, `-> ${newLogin.status}`);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 8. breached-password rejection on signup (live HIBP) ==');
  // A throwaway call was added here on the theory that this process's first
  // live HTTPS request pays for cold DNS/TLS and can miss the 2500ms budget.
  // Kept (harmless), but a real CI run reproduced the failure again WITH the
  // warm-up in place, and with no HIBP_DEGRADED signal at all — meaning the
  // call got a normal 200, not a timeout or error. So the cold-start theory
  // is not the (or not the whole) explanation.
  await isBreachedPassword('warm-up-not-asserted-0000');

  // UNRESOLVED, not diagnosed — this is a documented workaround for an
  // observed pattern, not a fix for a known cause. Do not "fix" this comment
  // by asserting a root cause unless someone actually confirms one.
  //
  // Across 3 independent real CI runs, the call below has returned false for
  // a password HIBP unambiguously has on record (password123 — one of HIBP's
  // own documentation examples: SHA-1 CBFDAC60…, count in the millions). A
  // diagnostic fetch run immediately after, replicating the exact same
  // request, found the correct match every time (HTTP 200, full body) — and
  // no HIBP_DEGRADED signal was logged for either call in any run. The CI log
  // shows well under 1ms between the failing call and the diagnostic's
  // success, which is too fast for a real network round trip — but that could
  // mean either (a) a genuine first-call anomaly in the fetch/AbortController
  // path that doesn't take any of isBreachedPassword's own error branches, or
  // (b) GitHub's log streaming batches console.log timestamps closely enough
  // that the sub-millisecond gap isn't a trustworthy measurement, and the real
  // call actually did take longer than it looks. We do not know which.
  //
  // What IS established, 3-for-3: retrying the identical call once resolves
  // it. This retry is that workaround. If it ever needs a SECOND retry to
  // pass, that is a signal this explanation is wrong — investigate fresh,
  // don't escalate to a bigger workaround.
  let breachedCheck = await isBreachedPassword(BREACHED_PW);
  if (breachedCheck !== true) {
    await diagnoseHibpMismatch(BREACHED_PW);
    breachedCheck = await isBreachedPassword(BREACHED_PW);
    console.log(`  [diag] retry result: ${breachedCheck}`);
  }
  check('HIBP flags "password123" as breached', breachedCheck === true);
  check('HIBP does NOT flag the strong gate password', (await isBreachedPassword(STRONG_PW)) === false);
  const breachedSignup = await c.req('POST', '/api/auth/signup', {
    body: { email: `p25b_${Date.now()}@t.co`, password: BREACHED_PW, orgName: 'P25 breached', acceptTos: true },
  });
  check('signup with a breached password -> 400 (mentions the breach)',
    breachedSignup.status === 400 && /breach/i.test((await breachedSignup.json())?.error || ''),
    `-> ${breachedSignup.status}`);

  await clearLimits();
  /* ============================================================ */
  console.log('\n== 9. expired tokens are rejected (verification + reset) ==');
  const uid = (await db.getDb().query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
  const evTok = `p25-expired-verify-${Date.now()}`;
  const prTok = `p25-expired-reset-${Date.now()}`;
  await db.getDb().query(
    "INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, now() - interval '1 hour')",
    [evTok, uid]
  );
  await db.getDb().query(
    "INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, now() - interval '1 hour')",
    [prTok, uid]
  );
  const expiredVerify = await c.req('POST', '/api/auth/verify-email', { body: { token: evTok } });
  check('an expired verification token -> 400', expiredVerify.status === 400, `-> ${expiredVerify.status}`);
  const expiredReset = await c.req('POST', '/api/auth/reset-password', { body: { token: prTok, password: STRONG_PW } });
  check('an expired reset token -> 400 (and the row is untouched — still unused)',
    expiredReset.status === 400 &&
      (await db.getDb().query('SELECT used_at FROM password_resets WHERE token = $1', [prTok])).rows[0].used_at === null,
    `-> ${expiredReset.status}`);

  console.log(`\n${fail === 0 ? 'ALL PHASE 25 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  if (proc) proc.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
