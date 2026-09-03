/**
 * Auth primitives + the requireAuth gate. No DB, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  validateCredentials,
  COOKIE_NAME,
} = require('../services/auth');

// requireAuth now does one primary-key user lookup per request (revocable
// sessions, Phase 24). Stub it: `dbUser` is what getUserById returns.
let dbUser = { id: 42, org_id: 5, email: 'x@y.com', role: 'owner', token_version: 0, email_verified_at: null };
const dbId = require.resolve('../db');
require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: { getUserById: async (id) => (dbUser && dbUser.id === id ? dbUser : null) },
};
const { requireAuth } = require('../middleware/requireAuth');

/* --- password hashing --------------------------------------------------- */

test('hashPassword / verifyPassword: round-trips, and is not reversible plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.match(hash, /^\$2[aby]\$/); // bcrypt format
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('verifyPassword: false on missing input rather than throwing', async () => {
  assert.equal(await verifyPassword('', 'x'), false);
  assert.equal(await verifyPassword('x', ''), false);
});

/* --- JWT -------------------------------------------------------------- */

test('signToken / verifyToken: carries userId + orgId + tv', () => {
  const token = signToken({ userId: 7, orgId: 3, email: 'a@b.com', tokenVersion: 4 });
  const payload = verifyToken(token);
  assert.equal(payload.userId, 7);
  assert.equal(payload.orgId, 3);
  assert.equal(payload.email, 'a@b.com');
  assert.equal(payload.tv, 4);
});

test('verifyToken: rejects a token signed with a different secret', () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ userId: 1, orgId: 999 }, 'not-the-real-secret');
  assert.throws(() => verifyToken(forged));
});

test('verifyToken: rejects a tampered token', () => {
  const token = signToken({ userId: 1, orgId: 1 });
  const tampered = token.slice(0, -4) + 'AAAA';
  assert.throws(() => verifyToken(tampered));
});

/* --- credential validation ------------------------------------------- */

test('validateCredentials: rejects bad email and short passwords', () => {
  assert.deepEqual(validateCredentials({ email: 'a@b.com', password: 'longenough' }), []);
  assert.ok(validateCredentials({ email: 'nope', password: 'longenough' }).length > 0);
  assert.ok(validateCredentials({ email: 'a@b.com', password: 'short' }).length > 0);
});

/* --- requireAuth middleware ----------------------------------------- */

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test('requireAuth: 401 when no cookie', async () => {
  const res = mockRes();
  let nexted = false;
  await requireAuth({ cookies: {} }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: 401 on an invalid token', async () => {
  const res = mockRes();
  let nexted = false;
  await requireAuth({ cookies: { [COOKIE_NAME]: 'garbage.token.here' } }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: attaches req.auth from a valid token when tv matches', async () => {
  dbUser = { id: 42, org_id: 5, email: 'x@y.com', role: 'owner', token_version: 3, email_verified_at: '2026-01-01T00:00:00Z' };
  const token = signToken({ userId: 42, orgId: 5, email: 'x@y.com', tokenVersion: 3 });
  const req = { cookies: { [COOKIE_NAME]: token } };
  const res = mockRes();
  let nexted = false;
  await requireAuth(req, res, () => (nexted = true));
  assert.equal(nexted, true);
  assert.deepEqual(req.auth, { userId: 42, orgId: 5, email: 'x@y.com', emailVerified: true });
});

test('requireAuth: req.auth.emailVerified is false when the user has not verified', async () => {
  dbUser = { id: 42, org_id: 5, email: 'x@y.com', role: 'owner', token_version: 0, email_verified_at: null };
  const token = signToken({ userId: 42, orgId: 5, email: 'x@y.com', tokenVersion: 0 });
  const req = { cookies: { [COOKIE_NAME]: token } };
  const res = mockRes();
  await requireAuth(req, res, () => {});
  assert.equal(req.auth.emailVerified, false);
});

test('requireAuth: 401 when the token tv is stale (logged out everywhere)', async () => {
  dbUser = { id: 42, org_id: 5, email: 'x@y.com', role: 'owner', token_version: 4 };
  const token = signToken({ userId: 42, orgId: 5, email: 'x@y.com', tokenVersion: 3 });
  const res = mockRes();
  let nexted = false;
  await requireAuth({ cookies: { [COOKIE_NAME]: token } }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /signed out/i);
});

test('requireAuth: a pre-Phase-24 token (no tv claim) still passes against token_version 0', async () => {
  dbUser = { id: 42, org_id: 5, email: 'x@y.com', role: 'owner', token_version: 0 };
  const jwt = require('jsonwebtoken');
  const legacy = jwt.sign({ userId: 42, orgId: 5, email: 'x@y.com' }, process.env.JWT_SECRET);
  const req = { cookies: { [COOKIE_NAME]: legacy } };
  const res = mockRes();
  let nexted = false;
  await requireAuth(req, res, () => (nexted = true));
  assert.equal(nexted, true);
  assert.equal(req.auth.userId, 42);
});

test('requireAuth: 401 when the user no longer exists', async () => {
  dbUser = null;
  const token = signToken({ userId: 42, orgId: 5, email: 'x@y.com', tokenVersion: 0 });
  const res = mockRes();
  let nexted = false;
  await requireAuth({ cookies: { [COOKIE_NAME]: token } }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: 401 when the token has no usable orgId', async () => {
  const token = signToken({ userId: 1, orgId: null });
  const res = mockRes();
  await requireAuth({ cookies: { [COOKIE_NAME]: token } }, res, () => {});
  assert.equal(res.statusCode, 401);
});
