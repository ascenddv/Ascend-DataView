/**
 * Phase 27 gate — account & data lifecycle (full delete + export).
 *
 * One backend on the local Postgres. Builds org A with a row in every
 * org-scoped table, plus a bystander org B, then:
 *   - GET /api/account/export returns all of A's data and none of B's, no hashes
 *   - a member and an unverified owner are refused delete/export
 *   - DELETE /api/organizations/:id with the typed name wipes every table for A,
 *     leaves B completely intact, and kills every A session
 *
 *   node scripts/phase27-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = 'C:/Ascend-DataView';
const PORT = 3151;
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
    const m = [...stdout.slice(sinceLen).matchAll(re)];
    if (m.length) return m[m.length - 1][1];
    await sleep(100);
  }
  throw new Error(`no ${kind} link on the log`);
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
      return { status: r.status, headers: r.headers, text: async () => r.text(), json: async () => r.json().catch(() => null) };
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
  const email = `p27_${label}_${s}@t.co`;
  const r = await client.req('POST', '/api/auth/signup', { body: { email, password: PW, orgName: `P27 ${label} ${s}`, acceptTos: true } });
  const org = (await r.json()).org;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  await client.req('POST', '/api/auth/login', { body: { email, password: PW } });
  return { email, org };
}

const ORG_TABLES = [
  'users', 'standardized_data', 'mapping_cache', 'chat_messages',
  'ascendai_usage', 'pending_uploads', 'invitations',
];
const countOrg = async (table, orgId) =>
  (await db.getDb().query(`SELECT count(*)::int n FROM ${table} WHERE org_id = $1`, [orgId])).rows[0].n;
const countUserScoped = async (table, orgId) =>
  (await db.getDb().query(
    `SELECT count(*)::int n FROM ${table} t JOIN users u ON u.id = t.user_id WHERE u.org_id = $1`, [orgId]
  )).rows[0].n;

let proc;
try {
  await db.initDb();
  proc = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env, PORT: String(PORT), DATABASE_URL: LOCAL_PG,
      RESEND_API_KEY: '', APP_BASE_URL: BASE, HIBP_CHECK_ENABLED: '0',
      GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', () => {});
  await waitHealth();

  /* ============================================================ */
  console.log('\n== 1. build org A with a row in every org-scoped table, plus org B ==');
  const ownerA = makeClient();
  const A = await signupVerified(ownerA, 'A');
  const ownerB = makeClient();
  const B = await signupVerified(ownerB, 'B');

  await clearLimits();
  await ownerA.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') }); // standardized_data
  const aOwnerId = (await db.getDb().query("SELECT id FROM users WHERE org_id=$1 AND role='owner' LIMIT 1", [A.org.id])).rows[0].id;
  await db.getDb().query(
    "INSERT INTO mapping_cache (org_id, header_hash, mapping_json) VALUES ($1, 'h27', '{}') ON CONFLICT DO NOTHING", [A.org.id]);
  await db.getDb().query(
    "INSERT INTO chat_messages (org_id, user_id, role, content) VALUES ($1,$2,'user','hello')", [A.org.id, aOwnerId]);
  await db.recordAscendaiUsage(A.org.id, aOwnerId, { status: 'seed', totalTokens: 1 });
  await db.putPendingUpload(A.org.id, { parsed: { headers: [], rows: [] }, mapping: {}, filename: 'x.csv', source: 'csv_upload' });
  await clearLimits();
  const inviteRes = await ownerA.req('POST', `/api/organizations/${A.org.id}/invitations`, { body: { email: `p27_invitee_${Date.now()}@t.co` } });
  const itoken = await waitForToken('accept-invite', 0);
  const member = makeClient();
  await member.req('POST', '/api/auth/accept-invite', { body: { token: itoken, password: PW } }); // 2nd user
  await clearLimits();
  await ownerA.req('POST', '/api/auth/forgot-password', { body: { email: A.email } }); // password_resets row

  // org B gets its own data so we can prove it survives
  await clearLimits();
  await ownerB.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
  const bMemberEmail = `p27_Bmember_${Date.now()}@t.co`;
  await clearLimits();
  await ownerB.req('POST', `/api/organizations/${B.org.id}/invitations`, { body: { email: bMemberEmail } });

  const preCounts = {};
  for (const t of ORG_TABLES) preCounts[t] = await countOrg(t, A.org.id);
  preCounts.email_verifications = await countUserScoped('email_verifications', A.org.id);
  preCounts.password_resets = await countUserScoped('password_resets', A.org.id);
  check('org A has a row in every table before deletion',
    Object.values(preCounts).every((n) => n > 0), JSON.stringify(preCounts));
  check('org A now has 2 users (owner + accepted invitee)', preCounts.users === 2, `users=${preCounts.users}`);

  /* ============================================================ */
  console.log('\n== 2. export: all of A, none of B, no password hashes ==');
  await clearLimits();
  const exp = await ownerA.req('GET', '/api/account/export');
  const raw = await exp.text();
  const bundle = JSON.parse(raw);
  check('GET /api/account/export -> 200 JSON attachment',
    exp.status === 200 &&
    /application\/json/.test(exp.headers.get('content-type') || '') &&
    /attachment; filename="ascenddv-export-org\d+-\d{4}-\d{2}-\d{2}\.json"/.test(exp.headers.get('content-disposition') || ''),
    `${exp.status} ${exp.headers.get('content-disposition')}`);
  check('the bundle is org A, with its members, periods and invitation',
    bundle.organization.id === A.org.id &&
    bundle.members.length === 2 &&
    bundle.standardizedData.length > 0 &&
    bundle.invitations.length >= 1);
  check('no password hash anywhere in the export', !/password_hash|"\$2[aby]\$/.test(raw));
  check('no row from org B leaks into A’s export', !raw.includes(bMemberEmail));

  const memberExport = await member.req('GET', '/api/account/export');
  check('a member cannot export -> 403', memberExport.status === 403, `-> ${memberExport.status}`);

  /* ============================================================ */
  console.log('\n== 3. delete guards: wrong name, cross-org, unverified owner ==');
  await clearLimits();
  const wrongName = await ownerA.req('DELETE', `/api/organizations/${A.org.id}`, { body: { confirm: 'nope' } });
  check('DELETE with the wrong confirmation text -> 400', wrongName.status === 400, `-> ${wrongName.status}`);
  const crossOrg = await ownerA.req('DELETE', `/api/organizations/${B.org.id}`, { body: { confirm: B.org.name } });
  check('DELETE another org (path id != session org) -> 403', crossOrg.status === 403, `-> ${crossOrg.status}`);
  const memberDelete = await member.req('DELETE', `/api/organizations/${A.org.id}`, { body: { confirm: A.org.name } });
  check('a member cannot delete the org -> 403', memberDelete.status === 403, `-> ${memberDelete.status}`);

  const ownerC = makeClient();
  const s = Date.now();
  await ownerC.req('POST', '/api/auth/signup', { body: { email: `p27_C_${s}@t.co`, password: PW, orgName: `P27 C ${s}`, acceptTos: true } });
  const cOrgId = (await db.getDb().query("SELECT id FROM organizations WHERE name = $1", [`P27 C ${s}`])).rows[0].id;
  await clearLimits();
  const unverifiedDelete = await ownerC.req('DELETE', `/api/organizations/${cOrgId}`, { body: { confirm: `P27 C ${s}` } });
  check('an unverified owner cannot delete -> 403 needsVerification',
    unverifiedDelete.status === 403 && (await unverifiedDelete.json())?.needsVerification === true);

  /* ============================================================ */
  console.log('\n== 4. delete org A: every table cleared, org B intact, sessions dead ==');
  await clearLimits();
  const del = await ownerA.req('DELETE', `/api/organizations/${A.org.id}`, { body: { confirm: A.org.name } });
  check('DELETE /api/organizations/:id (owner, verified, matching name) -> 200', del.status === 200, `-> ${del.status}`);

  let allZero = true;
  const post = {};
  for (const t of ORG_TABLES) { post[t] = await countOrg(t, A.org.id); if (post[t] !== 0) allZero = false; }
  post.email_verifications = await countUserScoped('email_verifications', A.org.id);
  post.password_resets = await countUserScoped('password_resets', A.org.id);
  if (post.email_verifications || post.password_resets) allZero = false;
  post.organizations = (await db.getDb().query('SELECT count(*)::int n FROM organizations WHERE id = $1', [A.org.id])).rows[0].n;
  if (post.organizations !== 0) allZero = false;
  check('every org-A row is gone across all tables', allZero, JSON.stringify(post));

  const bIntact =
    (await countOrg('users', B.org.id)) >= 1 &&
    (await countOrg('standardized_data', B.org.id)) > 0 &&
    (await countOrg('invitations', B.org.id)) >= 1 &&
    (await db.getDb().query('SELECT count(*)::int n FROM organizations WHERE id = $1', [B.org.id])).rows[0].n === 1;
  check('org B is completely untouched', bIntact);

  check('the deleting owner’s session is now 401', (await ownerA.req('GET', '/api/data')).status === 401);
  check('the removed org’s other member is also 401', (await member.req('GET', '/api/data')).status === 401);

  console.log(`\n${fail === 0 ? 'ALL PHASE 27 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  if (proc) proc.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);
