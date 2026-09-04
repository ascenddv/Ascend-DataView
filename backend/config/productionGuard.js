/**
 * Production config guard (Stage 5, Phase 30).
 *
 * On boot in a production-like environment (VERCEL set, or NODE_ENV=production)
 * this checks the env vars the app cannot safely run without and makes any
 * problem UNMISSABLE — a loud stderr banner plus a CONFIG_GUARD signal to the
 * observability layer (which forwards to Sentry when configured). It never
 * throws or exits: /api/health must stay up so the deployment is diagnosable.
 */

const { captureMessage } = require('../services/observability');

function isProdLike(env = process.env) {
  return Boolean(env.VERCEL || env.NODE_ENV === 'production');
}

// Every env var this guard inspects. Kept in sync with the README
// "Environment variables" table by test/configDocsMatch.test.js — a mismatch
// there fails the build, so this list and the docs cannot silently drift.
const CHECKED_VARS = [
  'JWT_SECRET',
  'DATABASE_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'CORS_ORIGINS',
  'APP_BASE_URL',
  'CRON_SECRET',
];

/**
 * @returns {{ ok: boolean, missing: string[], weak: string[] }}
 */
function inspectConfig(env = process.env) {
  const missing = [];
  const weak = [];

  const jwt = env.JWT_SECRET;
  if (!jwt) missing.push('JWT_SECRET');
  else if (jwt.length < 32) weak.push('JWT_SECRET (needs at least 32 characters)');
  else if (/dev-only|change-in-production|test-secret/i.test(jwt)) weak.push('JWT_SECRET (still a placeholder value)');

  if (!env.DATABASE_URL && !env.POSTGRES_URL) missing.push('DATABASE_URL');
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!env.CORS_ORIGINS) missing.push('CORS_ORIGINS');

  // EMAIL_FROM: without it, transactional email goes out from the shared Resend
  // sandbox sender (or not at all). Weak if it isn't an addressable identity.
  if (!env.EMAIL_FROM) missing.push('EMAIL_FROM');
  else if (!env.EMAIL_FROM.includes('@')) weak.push('EMAIL_FROM (not an email address)');

  // APP_BASE_URL: the origin every verification / reset / invite link in an
  // email is built from. Unset falls back to http://localhost:3001, so a prod
  // deploy without it emails links that go nowhere.
  if (!env.APP_BASE_URL) missing.push('APP_BASE_URL');
  else if (!/^https:\/\//i.test(env.APP_BASE_URL) || /localhost|127\.0\.0\.1/i.test(env.APP_BASE_URL)) {
    weak.push('APP_BASE_URL (should be the deployed https:// origin, not localhost)');
  }

  // CRON_SECRET: guards POST /api/internal/prune. Unset -> routes/internal.js
  // 401s every call, so the retention cron silently never prunes anything.
  if (!env.CRON_SECRET) missing.push('CRON_SECRET');
  else if (env.CRON_SECRET.length < 16) weak.push('CRON_SECRET (needs at least 16 characters)');

  return { ok: missing.length === 0 && weak.length === 0, missing, weak };
}

function checkProductionConfig(env = process.env) {
  if (!isProdLike(env)) return { skipped: true };

  const result = inspectConfig(env);
  if (result.ok) return result;

  const lines = [
    '',
    '  ############################################################',
    '  #  PRODUCTION CONFIG PROBLEM — the app is running but is  #',
    '  #  not correctly configured for production.               #',
    ...result.missing.map((m) => `  #   MISSING: ${m}`),
    ...result.weak.map((w) => `  #   WEAK:    ${w}`),
    '  #  Fix these env vars in the deployment settings.         #',
    '  ############################################################',
    '',
  ];
  try {
    process.stderr.write(`${lines.join('\n')}\n`);
  } catch { /* logging must never throw */ }
  captureMessage('CONFIG_GUARD', { missing: result.missing, weak: result.weak });
  return result;
}

module.exports = { checkProductionConfig, inspectConfig, isProdLike, CHECKED_VARS };
