/**
 * Auth primitives — password hashing (bcrypt) and session tokens (JWT).
 * No DB access here; routes/auth.js composes these with the db helpers.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { PASSWORD_MIN_LENGTH } = require('../config/thresholds');

const BCRYPT_ROUNDS = 12;
// Sessions are independently revocable via users.token_version (Phase 24), so
// the token itself no longer needs a long life. 2 days keeps a normal user
// logged in across a working session without a fresh login every visit.
const TOKEN_TTL = '2d';
const TOKEN_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'ascenddv_token';

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Sign a session token. `orgId` is the isolation claim; `tv` is the user's
 * token_version at mint time, checked by requireAuth so a bump revokes the
 * session. Keep the payload minimal.
 */
function signToken({ userId, orgId, email, tokenVersion = 0 }) {
  return jwt.sign({ userId, orgId, email, tv: tokenVersion }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

/** Verify a token; returns the payload or throws. */
function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

/** Cookie options for the session token. `secure` only outside local dev. */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_MS,
    path: '/',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials({ email, password }) {
  const errors = [];
  if (!email || !EMAIL_RE.test(String(email))) errors.push('A valid email is required.');
  if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  return errors;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  cookieOptions,
  validateCredentials,
  COOKIE_NAME,
  TOKEN_TTL,
  TOKEN_TTL_MS,
};
