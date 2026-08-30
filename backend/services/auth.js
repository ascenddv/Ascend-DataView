/**
 * Auth primitives — password hashing (bcrypt) and session tokens (JWT).
 * No DB access here; routes/auth.js composes these with the db helpers.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = '7d';
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

/** Sign a session token. `orgId` is the isolation claim; keep the payload minimal. */
function signToken({ userId, orgId, email }) {
  return jwt.sign({ userId, orgId, email }, jwtSecret(), { expiresIn: TOKEN_TTL });
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
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials({ email, password }) {
  const errors = [];
  if (!email || !EMAIL_RE.test(String(email))) errors.push('A valid email is required.');
  if (!password || String(password).length < 8) errors.push('Password must be at least 8 characters.');
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
};
