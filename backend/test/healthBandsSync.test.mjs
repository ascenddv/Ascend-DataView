/**
 * The health-score band thresholds (Stable/Strong cutoffs) must have exactly one
 * source of truth — shared/health-bands.json — read by BOTH the frontend
 * display module and the backend PDF report. This test fails if either side
 * re-hardcodes the numbers or stops reading the shared file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shared = require('../../shared/health-bands.json');
const pdf = require('../services/pdfReport');
const frontendSrc = readFileSync(
  fileURLToPath(new URL('../../frontend/src/lib/healthBands.js', import.meta.url)),
  'utf8'
);

test('the shared config holds sane, ordered thresholds', () => {
  assert.ok(Number.isInteger(shared.stableMin) && shared.stableMin > 0 && shared.stableMin < 100);
  assert.ok(Number.isInteger(shared.strongMin) && shared.strongMin > shared.stableMin && shared.strongMin < 100);
});

test('the backend PDF report reads its band thresholds from the shared config', () => {
  assert.equal(pdf.HEALTH_BAND_STABLE_MIN, shared.stableMin);
  assert.equal(pdf.HEALTH_BAND_STRONG_MIN, shared.strongMin);
});

test('bandLabel boundaries match the shared thresholds exactly', () => {
  assert.equal(pdf.bandLabel(shared.strongMin), 'Strong');
  assert.equal(pdf.bandLabel(shared.strongMin - 1), 'Stable');
  assert.equal(pdf.bandLabel(shared.stableMin), 'Stable');
  assert.equal(pdf.bandLabel(shared.stableMin - 1), 'Watch');
  assert.equal(pdf.bandLabel(null), 'Unavailable');
});

test('the frontend healthBands module reads the shared config, not a hardcoded literal', () => {
  assert.match(frontendSrc, /health-bands\.json/, 'must import shared/health-bands.json');
  // no `STABLE_MIN = 48` / `STRONG_MIN = 64` style re-hardcoding
  assert.doesNotMatch(frontendSrc, /STABLE_MIN\s*=\s*\d/);
  assert.doesNotMatch(frontendSrc, /STRONG_MIN\s*=\s*\d/);
});
