/**
 * routes/auth.js — the Phase 25 flows (verify-email, resend, forgot/reset
 * password) at the route level, with ../db, ../services/email and
 * ../services/passwordCheck stubbed. No live Postgres, no network, no real mail.
 *
 * What this locks in:
 *   - signup emails a verification link and the account starts unverified
 *   - a valid token verifies once; reuse / garbage / unknown -> 400
 *   - forgot-password is always 200 (no user enumeration) and only emails a
 *     real user
 *   - reset-password validates the NEW password BEFORE burning the token,
 *     rejects breached passwords, and on success bumps token_version + clears
 *     the cookie
 *   - a breached password is refused at signup
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

/* ---- stubs, installed before the router is required -------------------- */
const dbId = require.resolve('../db');
const emailId = require.resolve('../services/email');
const pwId = require.resolve('../services/passwordCheck');

const store = {
  users: new Map(), // id -> user row
  byEmail: new Map(), // email -> id
  verifications: new Map(), // token -> { userId, used, expired }
  resets: new Map(), // token -> { userId, used, expired }
  invitations: new Map(), // token -> { orgId, email, role, accepted }
  acceptCalls: [], // { token, email } acceptInvitation was actually invoked with
  nextId: 1,
};
const sent = []; // captured emails
let breached = new Set(); // passwords the fake HIBP flags

function resetStore() {
  store.users.clear();
  store.byEmail.clear();
  store.verifications.clear();
  store.resets.clear();
  store.invitations.clear();
  store.acceptCalls = [];
  store.nextId = 1;
  sent.length = 0;
  breached = new Set();
}

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    getDb: () => ({
      // only the rate limiter's PgRateStore calls this; keep it a no-op
      query: async () => ({ rows: [{ hits: 1, expires_at: new Date(Date.now() + 60000) }] }),
    }),
    createOrganization: async ({ name }) => ({ id: 100 + store.nextId, name, onboarding_completed: false }),
    createUser: async ({ orgId, email, passwordHash, role }) => {
      const id = store.nextId++;
      const row = { id, org_id: orgId, email: email.toLowerCase(), password_hash: passwordHash, role, token_version: 0, email_verified_at: null };
      store.users.set(id, row);
      store.byEmail.set(row.email, id);
      return { ...row };
    },
    getUserByEmail: async (email) => {
      const id = store.byEmail.get(String(email || '').toLowerCase());
      return id ? { ...store.users.get(id) } : null;
    },
    getUserById: async (id) => (store.users.get(id) ? { ...store.users.get(id) } : null),
    getOrganizationById: async (id) => ({ id, name: `Org ${id}`, onboarding_completed: false }),
    bumpTokenVersion: async (userId) => {
      const u = store.users.get(userId);
      if (!u) return null;
      u.token_version += 1;
      return u.token_version;
    },
    updateUserPassword: async (userId, hash) => {
      const u = store.users.get(userId);
      if (!u) return false;
      u.password_hash = hash;
      return true;
    },
    createEmailVerification: async (userId, token) => {
      store.verifications.set(token, { userId, used: false, expired: false });
    },
    consumeEmailVerification: async (token) => {
      const row = store.verifications.get(token);
      if (!row || row.used || row.expired) return null;
      row.used = true;
      const u = store.users.get(row.userId);
      if (u && !u.email_verified_at) u.email_verified_at = new Date().toISOString();
      return { userId: row.userId };
    },
    createPasswordReset: async (userId, token) => {
      store.resets.set(token, { userId, used: false, expired: false });
    },
    consumePasswordReset: async (token) => {
      const row = store.resets.get(token);
      if (!row || row.used || row.expired) return null;
      row.used = true;
      return { userId: row.userId };
    },
    applyPasswordReset: async (token, passwordHash) => {
      const row = store.resets.get(token);
      if (!row || row.used || row.expired) return null;
      const u = store.users.get(row.userId);
      if (!u) return null;
      row.used = true;
      u.password_hash = passwordHash;
      u.token_version += 1;
      if (!u.email_verified_at) u.email_verified_at = new Date().toISOString();
      return { userId: row.userId };
    },
    getInvitationByToken: async (token) => {
      const row = store.invitations.get(token);
      if (!row || row.accepted) return null;
      return { token, org_id: row.orgId, email: row.email, role: row.role };
    },
    acceptInvitation: async ({ token, email, passwordHash }) => {
      store.acceptCalls.push({ token, email });
      const row = store.invitations.get(token);
      if (!row || row.accepted) return null;
      if (store.byEmail.has(email.toLowerCase())) return null;
      row.accepted = true;
      const id = store.nextId++;
      const user = { id, org_id: row.orgId, email: email.toLowerCase(), password_hash: passwordHash, role: row.role, token_version: 0, email_verified_at: new Date().toISOString() };
      store.users.set(id, user);
      store.byEmail.set(user.email, id);
      return { ...user };
    },
  },
};
let emailDelayMs = 0; // simulate a slow provider for the timing test
require.cache[emailId] = {
  id: emailId, filename: emailId, loaded: true, children: [], paths: [],
  exports: {
    sendEmail: async (msg) => {
      sent.push(msg);
      if (emailDelayMs) await new Promise((r) => setTimeout(r, emailDelayMs));
      return { ok: true, dev: true };
    },
    verificationEmail: (to, token) => ({ to, subject: 'Verify your email', kind: 'verify', token, text: `link ${token}` }),
    passwordResetEmail: (to, token) => ({ to, subject: 'Reset your password', kind: 'reset', token, text: `link ${token}` }),
  },
};
require.cache[pwId] = {
  id: pwId, filename: pwId, loaded: true, children: [], paths: [],
  exports: { isBreachedPassword: async (pw) => breached.has(pw) },
};

const authRouter = require('../routes/auth');

const app = express();
app.use(require('cookie-parser')());
app.use(express.json());
app.use('/api/auth', authRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
test.beforeEach(resetStore);

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const GOOD_PW = 'a-strong-unique-passphrase-7712';

async function signup(email = 'owner@org.co') {
  const r = await post('/api/auth/signup', { email, password: GOOD_PW, orgName: 'Org', acceptTos: true });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, body: await r.json(), cookie };
}

test('signup: account starts unverified and a verification email goes out', async () => {
  const { status, body } = await signup();
  assert.equal(status, 201);
  assert.equal(body.user.emailVerified, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'verify');
  assert.equal(store.verifications.size, 1);
});

test('signup: a breached password is refused', async () => {
  breached = new Set([GOOD_PW]);
  const r = await post('/api/auth/signup', { email: 'x@y.co', password: GOOD_PW, orgName: 'Org', acceptTos: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /data breach/i);
  assert.equal(store.users.size, 0);
});

test('signup: without the ToS checkbox -> 400, nothing created', async () => {
  const r = await post('/api/auth/signup', { email: 'x@y.co', password: GOOD_PW, orgName: 'Org' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /terms of service/i);
  assert.equal(store.users.size, 0);

  const withBox = await post('/api/auth/signup', { email: 'x@y.co', password: GOOD_PW, orgName: 'Org', acceptTos: true });
  assert.equal(withBox.status, 201);
});

test('verify-email: a valid token verifies once; reuse and garbage 400', async () => {
  await signup();
  const token = [...store.verifications.keys()][0];

  const ok = await post('/api/auth/verify-email', { token });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).emailVerified, true);
  assert.ok(store.users.get(1).email_verified_at);

  const reuse = await post('/api/auth/verify-email', { token });
  assert.equal(reuse.status, 400);

  const garbage = await post('/api/auth/verify-email', { token: 'nope' });
  assert.equal(garbage.status, 400);
});

test('resend-verification: authed + unverified -> new token + email; already verified -> no-op', async () => {
  const { cookie } = await signup();
  const first = await post('/api/auth/resend-verification', {}, { Cookie: cookie });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).sent, true);
  assert.equal(store.verifications.size, 2);

  store.users.get(1).email_verified_at = new Date().toISOString();
  const after = await post('/api/auth/resend-verification', {}, { Cookie: cookie });
  assert.equal((await after.json()).alreadyVerified, true);
  assert.equal(store.verifications.size, 2); // unchanged
});

test('forgot-password: always 200, only emails a real account', async () => {
  await signup('real@org.co');
  sent.length = 0;

  const unknown = await post('/api/auth/forgot-password', { email: 'nobody@nowhere.co' });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, 0);

  const known = await post('/api/auth/forgot-password', { email: 'real@org.co' });
  assert.equal(known.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'reset');
  assert.equal(store.resets.size, 1);
});

test('forgot-password: no timing side-channel — the response does not wait for the email send', async () => {
  await signup('timing@org.co');
  emailDelayMs = 250; // a slow email provider
  try {
    const t0 = Date.now();
    const known = await post('/api/auth/forgot-password', { email: 'timing@org.co' });
    const knownMs = Date.now() - t0;

    const t1 = Date.now();
    const unknown = await post('/api/auth/forgot-password', { email: 'nobody@nowhere.co' });
    const unknownMs = Date.now() - t1;

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    // the known-email response returned BEFORE the 250ms send resolved
    assert.ok(knownMs < 150, `known-email response must not block on the send (took ${knownMs}ms)`);
    assert.ok(Math.abs(knownMs - unknownMs) < 120,
      `known (${knownMs}ms) and unknown (${unknownMs}ms) must be indistinguishable`);
  } finally {
    emailDelayMs = 0;
  }
});

test('reset-password: weak new password is rejected and the token is NOT consumed', async () => {
  await signup('u@org.co');
  await post('/api/auth/forgot-password', { email: 'u@org.co' });
  const token = [...store.resets.keys()][0];

  const weak = await post('/api/auth/reset-password', { token, password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(store.resets.get(token).used, false);
});

test('reset-password: a breached new password is rejected', async () => {
  await signup('u@org.co');
  await post('/api/auth/forgot-password', { email: 'u@org.co' });
  const token = [...store.resets.keys()][0];
  breached = new Set(['another-breached-one-99']);

  const r = await post('/api/auth/reset-password', { token, password: 'another-breached-one-99' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /data breach/i);
  assert.equal(store.resets.get(token).used, false);
});

test('accept-invite: a valid token creates a verified member in the invite’s org and logs them in', async () => {
  store.invitations.set('inv-tok', { orgId: 777, email: 'newbie@team.co', role: 'member', accepted: false });
  const r = await post('/api/auth/accept-invite', { token: 'inv-tok', password: 'a-fresh-strong-pass-8890' });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.user.role, 'member');
  assert.equal(body.user.emailVerified, true);
  assert.equal(body.org.id, 777);
  assert.match(r.headers.get('set-cookie') || '', /ascenddv_token=/);
  assert.equal(store.invitations.get('inv-tok').accepted, true);
});

test('accept-invite: hostile body fields (orgId / role / email) are ignored — the grant comes only from the invitation row', async () => {
  store.invitations.set('inv-adv', { orgId: 777, email: 'invited@team.co', role: 'member', accepted: false });

  const r = await post('/api/auth/accept-invite', {
    token: 'inv-adv',
    password: 'a-fresh-strong-pass-8890',
    // everything below is an attacker trying to escalate:
    orgId: 999,
    org_id: 999,
    role: 'owner',
    email: 'attacker@evil.com',
  });
  assert.equal(r.status, 201);
  const body = await r.json();

  // the new account is bound to the INVITATION, not the request body
  assert.equal(body.org.id, 777, 'org must be the invitation\'s org, not the body\'s orgId');
  assert.equal(body.user.role, 'member', 'role must be the invitation\'s role, not the body\'s role');
  assert.equal(body.user.email, 'invited@team.co', 'email must be the invitation\'s email, not the body\'s email');

  // and the route never even forwarded the hostile email into the db layer
  assert.deepEqual(store.acceptCalls, [{ token: 'inv-adv', email: 'invited@team.co' }]);

  // no user was created for the attacker address
  assert.equal(store.byEmail.has('attacker@evil.com'), false);
  const created = [...store.users.values()];
  assert.equal(created.length, 1);
  assert.equal(created[0].org_id, 777);
  assert.equal(created[0].role, 'member');
  assert.equal(created[0].email, 'invited@team.co');
});

test('accept-invite: invalid/revoked token -> 400; reused token -> 400; weak or breached password -> 400', async () => {
  const bad = await post('/api/auth/accept-invite', { token: 'nope', password: 'a-fresh-strong-pass-8890' });
  assert.equal(bad.status, 400);

  store.invitations.set('t2', { orgId: 1, email: 'x@team.co', role: 'member', accepted: false });
  const weak = await post('/api/auth/accept-invite', { token: 't2', password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(store.invitations.get('t2').accepted, false); // not consumed

  breached = new Set(['breached-invite-pass-1']);
  const brk = await post('/api/auth/accept-invite', { token: 't2', password: 'breached-invite-pass-1' });
  assert.equal(brk.status, 400);

  const ok = await post('/api/auth/accept-invite', { token: 't2', password: 'a-fresh-strong-pass-8890' });
  assert.equal(ok.status, 201);
  const reuse = await post('/api/auth/accept-invite', { token: 't2', password: 'another-strong-pass-2210' });
  assert.equal(reuse.status, 400);
});

test('reset-password: one txn — hash + token_version bump + email_verified_at + cookie clear + single-use', async () => {
  await signup('u@org.co');
  const before = store.users.get(1);
  const beforeHash = before.password_hash;
  assert.equal(before.email_verified_at, null); // unverified at signup

  await post('/api/auth/forgot-password', { email: 'u@org.co' });
  const token = [...store.resets.keys()][0];

  const ok = await post('/api/auth/reset-password', { token, password: 'brand-new-strong-pass-4410' });
  assert.equal(ok.status, 200);
  const after = store.users.get(1);
  assert.notEqual(after.password_hash, beforeHash);
  assert.equal(after.token_version, 1);
  assert.ok(after.email_verified_at != null, 'clicking the reset link proves mailbox control -> email marked verified');
  assert.match(ok.headers.get('set-cookie') || '', /ascenddv_token=;/); // cleared

  const reuse = await post('/api/auth/reset-password', { token, password: 'yet-another-strong-pass-5521' });
  assert.equal(reuse.status, 400);
});
