/**
 * Phase 12 — the recalibrated Strong / Stable / Watch display bands.
 * (Display layer only; the scoring formula is untouched and lives in the backend.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { healthBand, STABLE_MIN, STRONG_MIN } from '../src/lib/healthBands.js';
import SHARED_BANDS from '../../shared/health-bands.json' with { type: 'json' };

const load = (n) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}.json`, import.meta.url))));

test('thresholds are the derived values (48 / 64), not the old 60 / 80', () => {
  assert.equal(STABLE_MIN, 48);
  assert.equal(STRONG_MIN, 64);
});

test('thresholds come straight from the shared repo-root config', () => {
  assert.equal(STABLE_MIN, SHARED_BANDS.stableMin);
  assert.equal(STRONG_MIN, SHARED_BANDS.strongMin);
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

test('fixture_rich_v2 — realistic healthy org: 7 dimensions Stable/Strong, People legitimately Watch', () => {
  const { healthScores } = load('metrics_rich_v2');
  const scored = Object.values(healthScores).filter((h) => h.status === 'Available');
  assert.equal(scored.length, 8, 'all 8 dimensions score for the rich fixture');
  const band = Object.fromEntries(scored.map((h) => [h.dimension, healthBand(h.score).label]));

  // People reads Watch here for a REAL reason — not a fixture or banding bug.
  // Its two sub-metrics are headcount growth (healthy) and turnover-RATE growth
  // (inverted). Dec 2025 had one more departure than Nov while headcount grew,
  // so the turnover rate rose ~+13.5% period-over-period — outside "typical
  // healthy growth" — pulling the 2-sub-metric average to 46 (< 48). A thin
  // dimension surfacing a genuine one-month soft spot is the system working as
  // designed; the recalibration was scoped to stop *typical healthy growth*
  // (3–9% MoM) reading Watch, which it does for the other seven dimensions.
  assert.equal(band.People, 'Watch');
  assert.ok(healthScores.People.score < STABLE_MIN);
  const turnover = healthScores.People.subScores.find((s) => s.key === 'turnover_rate_growth');
  assert.ok(turnover.inverted && turnover.growthRate > 0, 'turnover rate rose period-over-period');

  for (const h of scored) {
    if (h.dimension === 'People') continue;
    assert.ok(
      ['Stable', 'Strong'].includes(band[h.dimension]),
      `${h.dimension} scored ${h.score} -> ${band[h.dimension]}, expected Stable/Strong`
    );
  }
});

test('fixture_sparse — a genuine decline — still reads Watch on Financial', () => {
  const { healthScores } = load('metrics_sparse_v2');
  assert.equal(healthScores.Financial.status, 'Available');
  assert.equal(healthBand(healthScores.Financial.score).label, 'Watch');
});
