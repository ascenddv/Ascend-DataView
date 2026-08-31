/**
 * Phase 12 — the recalibrated Strong / Stable / Watch display bands.
 * (Display layer only; the scoring formula is untouched and lives in the backend.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { healthBand, STABLE_MIN, STRONG_MIN } from '../src/lib/healthBands.js';

const load = (n) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}.json`, import.meta.url))));

test('thresholds are the derived values (48 / 64), not the old 60 / 80', () => {
  assert.equal(STABLE_MIN, 48);
  assert.equal(STRONG_MIN, 64);
});

test('band boundaries', () => {
  assert.equal(healthBand(47).label, 'Watch'); // sparse Financial — a real decline
  assert.equal(healthBand(48).label, 'Stable'); // exactly the Stable floor
  assert.equal(healthBand(50).label, 'Stable'); // flat — not in trouble
  assert.equal(healthBand(56).label, 'Stable'); // typical healthy growth
  assert.equal(healthBand(63).label, 'Stable'); // top of Stable
  assert.equal(healthBand(64).label, 'Strong'); // exactly the Strong floor
  assert.equal(healthBand(75).label, 'Strong');
});

test('non-numeric / missing score is treated as Watch, never crashes', () => {
  assert.equal(healthBand(null).label, 'Watch');
  assert.equal(healthBand(undefined).label, 'Watch');
  assert.equal(healthBand(NaN).label, 'Watch');
});

test('fixture_rich_v2 — a healthy org — reads Stable/Strong on every dimension, never Watch', () => {
  const { healthScores } = load('metrics_rich_v2');
  const scored = Object.values(healthScores).filter((h) => h.status === 'Available');
  assert.equal(scored.length, 8, 'all 8 dimensions score for the rich fixture');
  for (const h of scored) {
    const b = healthBand(h.score).label;
    assert.notEqual(b, 'Watch', `${h.dimension} scored ${h.score} but reads "Watch"`);
    assert.ok(['Stable', 'Strong'].includes(b));
  }
});

test('fixture_sparse — a genuine decline — still reads Watch on Financial', () => {
  const { healthScores } = load('metrics_sparse_v2');
  assert.equal(healthScores.Financial.status, 'Available');
  assert.equal(healthBand(healthScores.Financial.score).label, 'Watch');
});
