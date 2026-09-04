/**
 * config/productionGuard.js — the boot-time config check. It must be a no-op
 * outside a prod-like env, flag exactly the missing/weak vars in one, and never
 * throw.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectConfig, checkProductionConfig, isProdLike, CHECKED_VARS } = require('../config/productionGuard');

const FULL = {
  JWT_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgres://u:p@h:5432/db',
  RESEND_API_KEY: 're_live_key',
  CORS_ORIGINS: 'https://app.example',
  EMAIL_FROM: 'AscendDV <noreply@app.example>',
  APP_BASE_URL: 'https://app.example',
  CRON_SECRET: 'x'.repeat(24),
};

test('isProdLike: true only for VERCEL or NODE_ENV=production', () => {
  assert.equal(isProdLike({}), false);
  assert.equal(isProdLike({ NODE_ENV: 'development' }), false);
  assert.equal(isProdLike({ VERCEL: '1' }), true);
  assert.equal(isProdLike({ NODE_ENV: 'production' }), true);
});

test('inspectConfig: a complete config is ok', () => {
  const r = inspectConfig(FULL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.weak, []);
});

test('inspectConfig: names every missing var', () => {
  const r = inspectConfig({ JWT_SECRET: 'x'.repeat(40) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(),
    ['APP_BASE_URL', 'CORS_ORIGINS', 'CRON_SECRET', 'DATABASE_URL', 'EMAIL_FROM', 'RESEND_API_KEY']);
});

test('inspectConfig: flags a short or placeholder JWT_SECRET as weak', () => {
  assert.ok(inspectConfig({ ...FULL, JWT_SECRET: 'tooshort' }).weak.some((w) => /JWT_SECRET/.test(w)));
  assert.ok(inspectConfig({ ...FULL, JWT_SECRET: 'dev-only-secret-change-in-production-aaaa' }).weak.some((w) => /placeholder/.test(w)));
});

test('a deploy with the four classic vars set is NO LONGER called clean — CRON_SECRET / APP_BASE_URL / EMAIL_FROM are now caught', () => {
  const previouslyClean = {
    JWT_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://u:p@h:5432/db',
    RESEND_API_KEY: 're_live_key',
    CORS_ORIGINS: 'https://app.example',
    // CRON_SECRET / APP_BASE_URL / EMAIL_FROM intentionally absent
  };
  const r = inspectConfig(previouslyClean);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['APP_BASE_URL', 'CRON_SECRET', 'EMAIL_FROM']);
});

test('inspectConfig: a localhost or non-https APP_BASE_URL is weak (emails would link nowhere)', () => {
  assert.ok(inspectConfig({ ...FULL, APP_BASE_URL: 'http://localhost:3001' }).weak.some((w) => /APP_BASE_URL/.test(w)));
  assert.ok(inspectConfig({ ...FULL, APP_BASE_URL: 'http://app.example' }).weak.some((w) => /APP_BASE_URL/.test(w)));
  assert.equal(inspectConfig({ ...FULL, APP_BASE_URL: 'https://app.example' }).ok, true);
});

test('inspectConfig: EMAIL_FROM without an @ is weak; CRON_SECRET under 16 chars is weak', () => {
  assert.ok(inspectConfig({ ...FULL, EMAIL_FROM: 'noreply' }).weak.some((w) => /EMAIL_FROM/.test(w)));
  assert.ok(inspectConfig({ ...FULL, CRON_SECRET: 'short' }).weak.some((w) => /CRON_SECRET/.test(w)));
});

test('CHECKED_VARS is exactly the set inspectConfig({}) reports missing', () => {
  const missing = inspectConfig({}).missing;
  assert.deepEqual([...missing].sort(), [...CHECKED_VARS].sort());
});

test('inspectConfig: POSTGRES_URL satisfies the DB requirement', () => {
  const r = inspectConfig({ ...FULL, DATABASE_URL: undefined, POSTGRES_URL: 'postgres://u:p@h/db' });
  assert.ok(!r.missing.includes('DATABASE_URL'));
});

test('checkProductionConfig: skips entirely outside a prod-like env', () => {
  assert.deepEqual(checkProductionConfig({ NODE_ENV: 'test' }), { skipped: true });
});

test('checkProductionConfig: in a prod-like env it reports problems without throwing', () => {
  const original = process.stderr.write.bind(process.stderr);
  let banner = '';
  process.stderr.write = (c) => { banner += String(c); return true; };
  try {
    const r = checkProductionConfig({ VERCEL: '1' }); // nothing else set
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes('JWT_SECRET'));
  } finally {
    process.stderr.write = original;
  }
  assert.match(banner, /PRODUCTION CONFIG PROBLEM/);
  assert.match(banner, /MISSING: JWT_SECRET/);
});
