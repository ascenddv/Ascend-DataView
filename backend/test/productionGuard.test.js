/**
 * config/productionGuard.js — the boot-time config check. It must be a no-op
 * outside a prod-like env, flag exactly the missing/weak vars in one, and never
 * throw.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectConfig, checkProductionConfig, isProdLike } = require('../config/productionGuard');

const FULL = {
  JWT_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgres://u:p@h:5432/db',
  RESEND_API_KEY: 're_live_key',
  CORS_ORIGINS: 'https://app.example',
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
  assert.deepEqual(r.missing.sort(), ['CORS_ORIGINS', 'DATABASE_URL', 'RESEND_API_KEY']);
});

test('inspectConfig: flags a short or placeholder JWT_SECRET as weak', () => {
  assert.ok(inspectConfig({ ...FULL, JWT_SECRET: 'tooshort' }).weak.some((w) => /JWT_SECRET/.test(w)));
  assert.ok(inspectConfig({ ...FULL, JWT_SECRET: 'dev-only-secret-change-in-production-aaaa' }).weak.some((w) => /placeholder/.test(w)));
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
