/**
 * routes/organizations.js — the Phase 26 team surface (invitations + members)
 * with ../db, ../services/email and the rate-limit store stubbed.
 *
 * Locks in: owner-only enforcement (requireRole), the :id === session org guard
 * (sameOrg), no inviting an address that already has an account, owners can't be
 * removed and you can't remove yourself, and the pending-invite list/revoke.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
const emailId = require.resolve('../services/email');

const ORG = 42;
const state = { members: [], invites: [], accounts: new Set(), created: [], removed: [], deletedOrgs: [], aiToggles: [] };
const sent = [];

function seed() {
  state.members = [
    { id: 1, email: 'owner@org.co', role: 'owner', email_verified_at: '2026-01-01', created_at: '2026-01-01' },
    { id: 2, email: 'member@org.co', role: 'member', email_verified_at: null, created_at: '2026-02-01' },
  ];
  state.invites = [{ token: 'inv-1', email: 'pending@x.co', role: 'member', created_at: 'x', expires_at: 'y' }];
  state.accounts = new Set(['owner@org.co', 'member@org.co', 'taken@x.co']);
  state.created = [];
  state.removed = [];
  state.deletedOrgs = [];
  state.aiToggles = [];
  sent.length = 0;
}

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    getDb: () => ({ query: async () => ({ rows: [{ hits: 1, expires_at: new Date(Date.now() + 60000) }] }) }),
    getOrganizationById: async (id) => ({ id, name: `Org ${id}` }),
    deleteStandardizedData: async () => 0,
    setOnboardingCompleted: async () => true,
    getUserByEmail: async (email) => (state.accounts.has(String(email).toLowerCase()) ? { id: 99, email } : null),
    listOrgMembers: async (orgId) => (orgId === ORG ? state.members.slice() : []),
    removeOrgMember: async (orgId, userId) => {
      if (orgId !== ORG) return null;
      const m = state.members.find((x) => x.id === userId && x.role !== 'owner');
      if (!m) return null;
      state.removed.push(userId);
      return userId;
    },
    createInvitation: async (arg) => { state.created.push(arg); },
    listPendingInvitations: async (orgId) => (orgId === ORG ? state.invites.slice() : []),
    deleteInvitation: async (orgId, token) =>
      orgId === ORG && state.invites.some((i) => i.token === token) ? token : null,
    deleteOrganization: async (orgId) => { state.deletedOrgs.push(orgId); return orgId; },
    setOrgAscendaiEnabled: async (orgId, enabled) => { state.aiToggles.push([orgId, enabled]); return enabled; },
  },
};
require.cache[emailId] = {
  id: emailId, filename: emailId, loaded: true, children: [], paths: [],
  exports: {
    sendEmail: async (m) => { sent.push(m); return { ok: true }; },
    invitationEmail: (to, token, orgName) => ({ to, token, orgName, subject: 'invite' }),
  },
};

const organizationsRouter = require('../routes/organizations');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = {
    orgId: Number(req.headers['x-org']) || ORG,
    userId: Number(req.headers['x-user']) || 1,
    email: 'owner@org.co',
    role: req.headers['x-role'] || 'owner',
    emailVerified: req.headers['x-unverified'] ? false : true,
  };
  next();
});
app.use('/api', organizationsRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
test.beforeEach(seed);

const call = (method, path, { body, role, org, user, unverified } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers['x-role'] = role;
  if (org) headers['x-org'] = String(org);
  if (user) headers['x-user'] = String(user);
  if (unverified) headers['x-unverified'] = '1';
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
};

/* -- invitations ------------------------------------------------------------ */

test('owner invites a new address -> 201, invite stored, email sent', async () => {
  const r = await call('POST', `/api/organizations/${ORG}/invitations`, { body: { email: 'new@x.co', role: 'member' } });
  assert.equal(r.status, 201);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].email, 'new@x.co');
  assert.equal(state.created[0].role, 'member');
  assert.equal(sent.length, 1);
});

test('a member cannot invite -> 403, nothing created', async () => {
  const r = await call('POST', `/api/organizations/${ORG}/invitations`, { role: 'member', body: { email: 'new@x.co' } });
  assert.equal(r.status, 403);
  assert.equal(state.created.length, 0);
});

test('an unverified owner cannot invite -> 403 needsVerification', async () => {
  const r = await call('POST', `/api/organizations/${ORG}/invitations`, { unverified: true, body: { email: 'new@x.co' } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).needsVerification, true);
});

test('inviting an address that already has an account -> 409', async () => {
  const r = await call('POST', `/api/organizations/${ORG}/invitations`, { body: { email: 'taken@x.co' } });
  assert.equal(r.status, 409);
  assert.equal(state.created.length, 0);
});

test('inviting into another org (path id != session org) -> 403', async () => {
  const r = await call('POST', `/api/organizations/999/invitations`, { body: { email: 'new@x.co' } });
  assert.equal(r.status, 403);
  assert.equal(state.created.length, 0);
});

test('owner lists pending invites; a member gets 403', async () => {
  const ok = await call('GET', `/api/organizations/${ORG}/invitations`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).invitations.length, 1);

  const denied = await call('GET', `/api/organizations/${ORG}/invitations`, { role: 'member' });
  assert.equal(denied.status, 403);
});

test('owner revokes an invite; revoking an unknown token -> 404', async () => {
  const ok = await call('DELETE', `/api/organizations/${ORG}/invitations/inv-1`);
  assert.equal(ok.status, 200);
  const missing = await call('DELETE', `/api/organizations/${ORG}/invitations/nope`);
  assert.equal(missing.status, 404);
});

/* -- members ------------------------------------------------------------- */

test('any member can read the roster (with isYou)', async () => {
  const r = await call('GET', `/api/organizations/${ORG}/members`, { role: 'member', user: 2 });
  assert.equal(r.status, 200);
  const { members } = await r.json();
  assert.equal(members.length, 2);
  assert.equal(members.find((m) => m.id === 2).isYou, true);
  assert.ok(!('password_hash' in members[0]));
});

test('a member cannot remove anyone -> 403', async () => {
  const r = await call('DELETE', `/api/organizations/${ORG}/members/2`, { role: 'member' });
  assert.equal(r.status, 403);
  assert.equal(state.removed.length, 0);
});

test('owner cannot remove an owner, cannot remove self, can remove a member', async () => {
  const anOwner = await call('DELETE', `/api/organizations/${ORG}/members/1`, { user: 5 });
  assert.equal(anOwner.status, 403);

  const self = await call('DELETE', `/api/organizations/${ORG}/members/5`, { user: 5 });
  assert.equal(self.status, 400);

  const ok = await call('DELETE', `/api/organizations/${ORG}/members/2`, { user: 1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(state.removed, [2]);

  const gone = await call('DELETE', `/api/organizations/${ORG}/members/123`, { user: 1 });
  assert.equal(gone.status, 404);
});

/* -- delete organization ---------------------------------------------- */

test('DELETE /organizations/:id — owner + matching name -> 200, cascade helper called, cookie cleared', async () => {
  const r = await call('DELETE', `/api/organizations/${ORG}`, { body: { confirm: `Org ${ORG}` } });
  assert.equal(r.status, 200);
  assert.deepEqual(state.deletedOrgs, [ORG]);
  assert.match(r.headers.get('set-cookie') || '', /ascenddv_token=;/);
});

test('DELETE /organizations/:id — wrong confirmation text -> 400, nothing deleted', async () => {
  const r = await call('DELETE', `/api/organizations/${ORG}`, { body: { confirm: 'not the name' } });
  assert.equal(r.status, 400);
  assert.equal(state.deletedOrgs.length, 0);
});

test('DELETE /organizations/:id — a member -> 403; another org id -> 403', async () => {
  const asMember = await call('DELETE', `/api/organizations/${ORG}`, { role: 'member', body: { confirm: `Org ${ORG}` } });
  assert.equal(asMember.status, 403);
  const otherOrg = await call('DELETE', `/api/organizations/999`, { body: { confirm: 'Org 999' } });
  assert.equal(otherOrg.status, 403);
  assert.equal(state.deletedOrgs.length, 0);
});

test('DELETE /organizations/:id — an unverified owner -> 403 needsVerification', async () => {
  const r = await call('DELETE', `/api/organizations/${ORG}`, { unverified: true, body: { confirm: `Org ${ORG}` } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).needsVerification, true);
});

/* -- PATCH org settings (Phase 28 AscendAI toggle) --------------------- */

test('PATCH /organizations/:id — owner toggles ascendaiEnabled', async () => {
  const off = await call('PATCH', `/api/organizations/${ORG}`, { body: { ascendaiEnabled: false } });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).ascendaiEnabled, false);
  assert.deepEqual(state.aiToggles.at(-1), [ORG, false]);
});

test('PATCH /organizations/:id — a member -> 403; a non-boolean body -> 400; another org -> 403', async () => {
  assert.equal((await call('PATCH', `/api/organizations/${ORG}`, { role: 'member', body: { ascendaiEnabled: false } })).status, 403);
  assert.equal((await call('PATCH', `/api/organizations/${ORG}`, { body: { ascendaiEnabled: 'nope' } })).status, 400);
  assert.equal((await call('PATCH', `/api/organizations/999`, { body: { ascendaiEnabled: true } })).status, 403);
  assert.equal(state.aiToggles.length, 0);
});

test('PATCH /organizations/:id — an unverified owner -> 403 needsVerification, nothing toggled', async () => {
  const r = await call('PATCH', `/api/organizations/${ORG}`, { unverified: true, body: { ascendaiEnabled: false } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).needsVerification, true);
  assert.equal(state.aiToggles.length, 0);
});
