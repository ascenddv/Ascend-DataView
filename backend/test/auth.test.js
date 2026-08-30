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

test('signToken / verifyToken: carries userId + orgId', () => {
  const token = signToken({ userId: 7, orgId: 3, email: 'a@b.com' });
  const payload = verifyToken(token);
  assert.equal(payload.userId, 7);
  assert.equal(payload.orgId, 3);
  assert.equal(payload.email, 'a@b.com');
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

test('requireAuth: 401 when no cookie', () => {
  const res = mockRes();
  let nexted = false;
  requireAuth({ cookies: {} }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: 401 on an invalid token', () => {
  const res = mockRes();
  let nexted = false;
  requireAuth({ cookies: { [COOKIE_NAME]: 'garbage.token.here' } }, res, () => (nexted = true));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: attaches req.auth.orgId from a valid token', () => {
  const token = signToken({ userId: 42, orgId: 5, email: 'x@y.com' });
  const req = { cookies: { [COOKIE_NAME]: token } };
  const res = mockRes();
  let nexted = false;
  requireAuth(req, res, () => (nexted = true));
  assert.equal(nexted, true);
  assert.deepEqual(req.auth, { userId: 42, orgId: 5, email: 'x@y.com' });
});

test('requireAuth: 401 when the token has no usable orgId', () => {
  const token = signToken({ userId: 1, orgId: null });
  const res = mockRes();
  requireAuth({ cookies: { [COOKIE_NAME]: token } }, res, () => {});
  assert.equal(res.statusCode, 401);
});
