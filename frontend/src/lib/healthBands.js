/**
 * Health-score display bands — the single source of truth mapping a 0–100 score
 * to a qualitative label. DISPLAY LAYER ONLY: the scoring formula
 * (`clamp(50 + growthRate*100)`, averaged per dimension) is locked and lives in
 * the backend; this file never touches it.
 *
 * Thresholds (Phase 12, derived from an actual score-distribution analysis, not
 * guessed — see scripts/analyze-health-bands.mjs and CLAUDE.md):
 *
 *   The formula is linear, so a dimension's score ≈ 50 + (avg period-over-period
 *   growth of its sub-metrics) × 100.
 *     score 48  ⟺  −2%  avg MoM  (a genuine, if mild, decline)
 *     score 50  ⟺   0%          (flat / holding steady)
 *     score 53–59 ⟺ +3%…+9%     (typical healthy nonprofit growth)
 *     score 64  ⟺ +14% avg MoM  (sustained, well above typical)
 *
 *   Watch   score < 48   — declining; needs attention
 *   Stable  48 – 63       — holding steady through healthy growth
 *   Strong  score ≥ 64    — sustained growth well above typical
 *
 *   The old 60/80 cutoffs required +10% MoM on *every* sub-metric just to clear
 *   "Watch" and +30% to read "Strong", so ordinary healthy orgs all read Watch.
 */

export const HEALTH_BANDS = {
  WATCH: {
    label: 'Watch',
    color: 'var(--status-warning)',
    blurb: 'Declining — worth a closer look.',
  },
  STABLE: {
    label: 'Stable',
    color: 'var(--series-1)',
    blurb: 'Holding steady or growing at a healthy pace.',
  },
  STRONG: {
    label: 'Strong',
    color: 'var(--status-good)',
    blurb: 'Sustained growth well above what is typical.',
  },
};

export const STABLE_MIN = 48;
export const STRONG_MIN = 64;

/** Map a numeric health score to its band descriptor. */
export function healthBand(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return HEALTH_BANDS.WATCH;
  if (score >= STRONG_MIN) return HEALTH_BANDS.STRONG;
  if (score >= STABLE_MIN) return HEALTH_BANDS.STABLE;
  return HEALTH_BANDS.WATCH;
}
