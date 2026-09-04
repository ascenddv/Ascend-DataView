/**
 * Phase 26 gate — team invites & owner/member roles.
 *
 * One backend on the local Postgres, RESEND_API_KEY unset so the accept-invite
 * links are scraped off stdout. Signups are marked verified directly (the
 * verification flow is Phase 25's gate); this one is about RBAC + invitations.
 *
 *   node scripts/phase26-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const db = require('../db');
const { ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG } = require('../config/thresholds');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const PORT = 3141;
const BASE = `http://localhost:${PORT}`;
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const PW = 'ascend-gate-K7m2Qp-Zx9';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stdout = '';
async function waitHealth(tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* */ }
    await sleep(250);
  }
  throw new Error('backend never became healthy');
}
async function waitForToken(kind, sinceLen = 0, tries = 40) {
  const re = new RegExp(`/${kind}\\?token=([0-9a-f]{64})`, 'g');
  for (let i = 0; i < tries; i += 1) {
    const matches = [...stdout.slice(sinceLen).matchAll(re)];
    if (matches.length) return matches[matches.length - 1][1];
    await sleep(100);
  }
  throw new Error(`no ${kind} link appeared on the backend log`);
}
function makeClient() {
  let cookie = null;
  return {
    getCookie: () => cookie,
    setCookie: (c) => { cookie = c; },
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
const clearLimits = () => db.getDb().query('DELETE FROM rate_limits');
async function signupVerified(client, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const email = `p26_${label}_${s}@t.co`;
  const r = await client.req('POST', '/api/auth/signup', { body: { email, password: PW, orgName: `P26 ${label} ${s}`, acceptTos: true } });
  const org = (await r.json()).org;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  // re-login so the session cookie reflects the verified state
  await client.req('POST', '/api/auth/login', { body: { email, password: PW } });
  return { email, org };
}

let proc;
try {
  await db.initDb();
  proc = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env,
      PORT: String(PORT), DATABASE_URL: LOCAL_PG,
      RESEND_API_KEY: '', APP_BASE_URL: BASE, HIBP_CHECK_ENABLED: '0',
      GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', () => {});
  await waitHealth();

  /* ============================================================ */
  console.log('\n== 1. two orgs; owner A loads data ==');
  const ownerA = makeClient();
  const A = await signupVerified(ownerA, 'ownerA');
  const ownerB = makeClient();
  const B = await signupVerified(ownerB, 'ownerB');
  await clearLimits();
  const upA = await ownerA.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
  check('owner A uploads data -> 200', upA.status === 200);
  const metricsA = await (await ownerA.req('GET', '/api/metrics')).json();
  const periodsA = metricsA?.dataset?.periodCount || 0;
  check('owner A now has metrics', periodsA > 0, `periodCount=${periodsA}`);

  /* ============================================================ */
  console.log('\n== 2. owner A invites a member; the invitee accepts into org A ==');
  await clearLimits();
  const beforeInvite = stdout.length;
  const inv = await ownerA.req('POST', `/api/organizations/${A.org.id}/invitations`, {
    body: { email: `p26_member_${Date.now()}@t.co`, role: 'member' },
  });
  check('POST /organizations/:id/invitations (owner, verified) -> 201', inv.status === 201, `-> ${inv.status}`);
  const itoken = await waitForToken('accept-invite', beforeInvite);
  check('an accept-invite link was emailed', typeof itoken === 'string' && itoken.length === 64);

  const member = makeClient();
  const accept = await member.req('POST', '/api/auth/accept-invite', { body: { token: itoken, password: PW } });
  check('POST /api/auth/accept-invite -> 201', accept.status === 201, `-> ${accept.status}`);
  const memberMe = await (await member.req('GET', '/api/auth/me')).json();
  check('the invitee is in org A, role member, email pre-verified',
    memberMe?.org?.id === A.org.id && memberMe?.user?.role === 'member' && memberMe?.user?.emailVerified === true,
    JSON.stringify({ org: memberMe?.org?.id, role: memberMe?.user?.role }));

  /* ============================================================ */
  console.log('\n== 3. the member shares org A data + AscendAI cap, but has its own chat history ==');
  const memberMetrics = await (await member.req('GET', '/api/metrics')).json();
  check('member sees the SAME metrics as owner A',
    (memberMetrics?.dataset?.periodCount || 0) === periodsA, `member=${memberMetrics?.dataset?.periodCount} owner=${periodsA}`);

  // seed a chat message + max out usage for org A
  await db.getDb().query(
    "INSERT INTO chat_messages (org_id, user_id, role, content) SELECT $1, id, 'user', 'owner-only note' FROM users WHERE org_id=$1 AND role='owner'",
    [A.org.id]
  );
  const memberHistory = await (await member.req('GET', '/api/ascendai/chat')).json();
  check('member GET /api/ascendai/chat is empty (per-user history, not the owner’s)',
    Array.isArray(memberHistory?.messages) && memberHistory.messages.length === 0);

  const uid = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='owner' LIMIT 1", [A.org.id])).rows[0].id;
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  let used = await db.countAscendaiUsageSince(A.org.id, startOfDay.toISOString());
  for (; used < ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG; used += 1) {
    await db.recordAscendaiUsage(A.org.id, uid, { status: 'ok', totalTokens: 0 });
  }
  await clearLimits();
  const memberChat = await member.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } });
  const memberChatBody = await memberChat.json();
  check('member POST /api/ascendai/chat is blocked by org A’s shared daily cap',
    memberChat.status === 200 && memberChatBody?.status === 'rate_limited', JSON.stringify(memberChatBody?.status));

  /* ============================================================ */
  console.log('\n== 4. the member is denied every owner-only action, and cannot touch org B ==');
  await clearLimits();
  const mInvite = await member.req('POST', `/api/organizations/${A.org.id}/invitations`, { body: { email: 'x@y.co' } });
  check('member invite -> 403', mInvite.status === 403, `-> ${mInvite.status}`);
  const ownerAId = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='owner' LIMIT 1", [A.org.id])).rows[0].id;
  const mRemove = await member.req('DELETE', `/api/organizations/${A.org.id}/members/${ownerAId}`);
  check('member remove-member -> 403', mRemove.status === 403, `-> ${mRemove.status}`);
  const mReset = await member.req('DELETE', `/api/organizations/${A.org.id}/data`, { body: { confirm: A.org.name } });
  check('member data-reset -> 403', mReset.status === 403, `-> ${mReset.status}`);
  const aTouchesB = await ownerA.req('POST', `/api/organizations/${B.org.id}/invitations`, { body: { email: 'x@y.co' } });
  check('owner A inviting into org B (path id != session org) -> 403', aTouchesB.status === 403, `-> ${aTouchesB.status}`);

  /* ============================================================ */
  console.log('\n== 5. owner sees the roster; an owner-role invite can itself invite ==');
  const roster = await (await ownerA.req('GET', `/api/organizations/${A.org.id}/members`)).json();
  check('roster has 2 members (1 owner, 1 member)',
    roster?.members?.length === 2 && roster.members.filter((m) => m.role === 'owner').length === 1,
    JSON.stringify(roster?.members?.map((m) => m.role)));

  await clearLimits();
  const beforeOwnerInv = stdout.length;
  await ownerA.req('POST', `/api/organizations/${A.org.id}/invitations`, {
    body: { email: `p26_coowner_${Date.now()}@t.co`, role: 'owner' },
  });
  const otoken = await waitForToken('accept-invite', beforeOwnerInv);
  const coOwner = makeClient();
  await coOwner.req('POST', '/api/auth/accept-invite', { body: { token: otoken, password: PW } });
  const coOwnerMe = await (await coOwner.req('GET', '/api/auth/me')).json();
  check('the owner-role invitee is an owner', coOwnerMe?.user?.role === 'owner');
  await clearLimits();
  const coOwnerInvite = await coOwner.req('POST', `/api/organizations/${A.org.id}/invitations`, {
    body: { email: `p26_more_${Date.now()}@t.co` },
  });
  check('the new owner can invite -> 201', coOwnerInvite.status === 201, `-> ${coOwnerInvite.status}`);

  /* ============================================================ */
  console.log('\n== 6. a revoked invitation cannot be accepted ==');
  await clearLimits();
  const beforeRevoke = stdout.length;
  await ownerA.req('POST', `/api/organizations/${A.org.id}/invitations`, { body: { email: `p26_revoked_${Date.now()}@t.co` } });
  const rtoken = await waitForToken('accept-invite', beforeRevoke);
  const pending = await (await ownerA.req('GET', `/api/organizations/${A.org.id}/invitations`)).json();
  const revoke = await ownerA.req('DELETE', `/api/organizations/${A.org.id}/invitations/${rtoken}`);
  check('owner revokes the pending invite -> 200', revoke.status === 200 && pending?.invitations?.some((i) => i.token === rtoken));
  await clearLimits();
  const acceptRevoked = await makeClient().req('POST', '/api/auth/accept-invite', { body: { token: rtoken, password: PW } });
  check('accepting a revoked token -> 400', acceptRevoked.status === 400, `-> ${acceptRevoked.status}`);

  /* ============================================================ */
  console.log('\n== 7. removing the member kills their session ==');
  const memberId = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='member' LIMIT 1", [A.org.id])).rows[0].id;
  const rm = await ownerA.req('DELETE', `/api/organizations/${A.org.id}/members/${memberId}`);
  check('owner removes the member -> 200', rm.status === 200, `-> ${rm.status}`);
  const afterRemoval = await member.req('GET', '/api/data');
  check('the removed member’s next request -> 401', afterRemoval.status === 401, `-> ${afterRemoval.status}`);

  console.log(`\n${fail === 0 ? 'ALL PHASE 26 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  if (proc) proc.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
