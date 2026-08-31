/**
 * Phase 12 — derive Strong / Stable / Watch band thresholds from the ACTUAL
 * locked scoring formula, not another guess.
 *
 * The formula (unchanged, do not modify): per available sub-metric,
 *   subScore = clamp(50 + effectiveGrowthRate * 100, 0, 100)
 * dimension score = average of its sub-scores. So a dimension whose sub-metrics
 * all move at period-over-period rate g scores ~ clamp(50 + g*100).
 *
 *   node scripts/analyze-health-bands.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { calculateHealthScore } = require('../services/metrics.js');

const pct = (g) => `${g >= 0 ? '+' : ''}${(g * 100).toFixed(0)}%`;

/* -- 1. uniform sweep: every sub-metric of a dimension at the same rate g -- */
console.log('== Uniform period-over-period growth across a dimension ==');
console.log('  (a 3-sub-metric dimension; a rate applied uniformly ≈ clamp(50 + g*100))\n');
console.log('   MoM growth   score   old band (60/80)');
const rows = [];
for (let g = -0.2; g <= 0.2001; g += 0.01) {
  const subs = ['a', 'b', 'c'].map((key) => ({ key, growthRate: g }));
  const { score } = calculateHealthScore('X', subs);
  const oldBand = score >= 80 ? 'Strong' : score >= 60 ? 'Stable' : 'Watch';
  rows.push({ g, score });
  console.log(`   ${pct(g).padStart(7)}      ${String(score).padStart(3)}     ${oldBand}`);
}

/* -- 2. realistic mixed profiles (what real orgs actually look like) ------- */
console.log('\n== Realistic mixed dimension profiles ==');
const profiles = [
  ['Declining        (all sub-metrics -8% to -3%)', [-0.08, -0.05, -0.03]],
  ['Slipping         (-4% to +1%)', [-0.04, -0.01, 0.01]],
  ['Flat / holding   (-1% to +1%)', [-0.01, 0.0, 0.01]],
  ['Modest healthy   (+2% to +6%)', [0.02, 0.04, 0.06]],
  ['Typical healthy  (+4% to +9%)', [0.04, 0.06, 0.09]],
  ['Strong growth    (+9% to +15%)', [0.09, 0.12, 0.15]],
  ['Exceptional      (+15% to +25%)', [0.15, 0.2, 0.25]],
  ['Mixed w/ 1 drag  (+7%, +6%, -12% inverted-style drag)', [0.07, 0.06, -0.12]],
];
console.log('\n   profile                                              score');
for (const [label, rates] of profiles) {
  const subs = rates.map((growthRate, i) => ({ key: `s${i}`, growthRate }));
  const { score } = calculateHealthScore('X', subs);
  console.log(`   ${label.padEnd(52)} ${String(score).padStart(3)}`);
}

/* -- 3. the fixture scores we need the bands to classify correctly -------- */
console.log('\n== Reference points the new bands must get right ==');
console.log('   fixture_rich_v2  (a healthy org)  : dimensions land ~54–63');
console.log('   fixture_sparse   (a real decline) : Financial = 47  → must stay "Watch"');

/* -- 4. proposed thresholds --------------------------------------------- */
const g_at = (s) => ((s - 50) / 100); // inverse of clamp(50 + g*100) in-range
console.log('\n== Proposed bands (derived, not guessed) ==');
console.log(`   Watch  : score < 48   ( < ${pct(g_at(48))} avg MoM — a genuine decline )`);
console.log(`   Stable : 48 – 63      ( ${pct(g_at(48))} … ${pct(g_at(64))} — holding steady to healthy growth )`);
console.log(`   Strong : score ≥ 64   ( ≥ ${pct(g_at(64))} avg MoM — sustained, well above typical )`);
console.log('\n   Rationale:');
console.log('   - "typical healthy" nonprofit MoM growth is ~3–9%  → scores 53–59  → Stable (was wrongly Watch)');
console.log('   - flat (0% growth, score 50) is "not in trouble"   → Stable, not Watch');
console.log('   - a real decline of a few percent (score < 48)     → Watch (sparse Financial 47 qualifies)');
console.log('   - Strong is reserved for ≥ ~14% sustained MoM growth (score ≥ 64) — rare, genuinely outperforming');
