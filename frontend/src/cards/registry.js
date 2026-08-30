/**
 * Card registry — turns an /api/metrics payload into an ordered list of card
 * descriptors. The Overview page renders whatever this returns; it has no
 * hardcoded knowledge of which cards exist.
 *
 * `planCards` is pure data-in/data-out (no component imports) so it is testable
 * on its own. Dashboard maps each descriptor's `type` to a component.
 *
 * A card is emitted ONLY when the API says its type is eligible AND the backing
 * data is actually present, so nothing downstream ever renders "N/A", a
 * stand-in zero, or an empty chart. Each descriptor also carries a `category`
 * (a health-dimension name) so the per-dimension views can filter this one list
 * — the eligibility decision still lives only in the backend engine.
 *
 * Priority (lower = earlier): 1 health scores, 2 KPIs, 3 trend + comparison,
 * 4 risk/opportunity.
 */

import { formatPeriod } from '../lib/format.js';

export const CARD_TYPES = {
  HEALTH: 'health',
  KPI: 'kpi',
  TREND: 'trend',
  BAR: 'bar',
  RISK: 'risk',
};

export const OVERVIEW = 'overview';

// Series shown as their own Trend card when the Trend card type is Available.
const TREND_SERIES = [
  { key: 'revenue', label: 'Revenue', format: 'currency', category: 'Financial' },
  { key: 'expenses', label: 'Expenses', format: 'currency', category: 'Financial' },
  { key: 'cash_balance', label: 'Cash balance', format: 'currency', category: 'Financial' },
];

const CURRENCY_KPI_KEYS = new Set(['revenue', 'expenses', 'cash_balance']);

// Which health dimension each non-health card belongs to.
const KPI_CATEGORY = {
  revenue: 'Financial',
  expenses: 'Financial',
  cash_balance: 'Financial',
  donors_total: 'Community',
};
const RISK_CATEGORY = {
  funding_concentration: 'Financial',
  cash_runway: 'Financial',
  revenue_decline: 'Financial',
  donor_retention: 'Community',
};

export function planCards(metrics) {
  if (!metrics || !metrics.dataset) return [];

  const {
    cards: eligibility = {},
    healthScores = {},
    kpis = [],
    series = {},
    revenueByCategory = [],
    risksOpportunities = [],
    dataset = {},
  } = metrics;

  const out = [];

  // 1 — Health score cards: one per dimension that actually scored, in whatever
  // order the API returned them (backend emits them in health-config order).
  if (eligibility.HealthScore !== 'Unavailable') {
    for (const [dimension, h] of Object.entries(healthScores)) {
      if (h && h.status === 'Available' && typeof h.score === 'number') {
        out.push({
          key: `health-${dimension}`,
          type: CARD_TYPES.HEALTH,
          category: dimension,
          priority: 1,
          span: 1,
          props: { dimension, score: h.score, subScores: h.subScores || [] },
        });
      }
    }
  }

  // 2 — KPI cards: whatever the API computed a headline for.
  if (eligibility.KPI !== 'Unavailable') {
    for (const kpi of kpis) {
      out.push({
        key: `kpi-${kpi.key}`,
        type: CARD_TYPES.KPI,
        category: KPI_CATEGORY[kpi.key] || 'Financial',
        priority: 2,
        span: 1,
        props: {
          label: kpi.label,
          latest: kpi.latest,
          change: kpi.change,
          growthRate: kpi.growthRate,
          format: CURRENCY_KPI_KEYS.has(kpi.key) ? 'currency' : 'number',
          limited: eligibility.KPI === 'Limited',
        },
      });
    }
  }

  // 3 — Trend cards: only when Available (a Limited 3-point series is not shown).
  if (eligibility.Trend === 'Available') {
    for (const t of TREND_SERIES) {
      const points = series[t.key];
      if (Array.isArray(points) && points.length >= 2) {
        out.push({
          key: `trend-${t.key}`,
          type: CARD_TYPES.TREND,
          category: t.category,
          priority: 3,
          span: 1,
          props: { label: t.label, series: points, format: t.format },
        });
      }
    }
  }

  // 3 — Bar comparison: revenue by source for the latest period.
  if (eligibility.BarComparison === 'Available' && revenueByCategory.length >= 2) {
    out.push({
      key: 'bar-revenue-by-source',
      type: CARD_TYPES.BAR,
      category: 'Financial',
      priority: 3,
      span: 2,
      props: {
        title: `Revenue by source — ${formatPeriod(dataset.latestPeriod)}`,
        data: revenueByCategory,
        format: 'currency',
      },
    });
  }

  // 4 — Risk / opportunity cards: one per fired rule.
  if (eligibility.RiskOpportunity === 'Available') {
    for (const r of risksOpportunities) {
      out.push({
        key: `risk-${r.key}`,
        type: CARD_TYPES.RISK,
        category: RISK_CATEGORY[r.key] || 'Financial',
        priority: 4,
        span: 1,
        props: { type: r.type, title: r.title, detail: r.detail },
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/** The per-dimension view names, in the API's dimension order. */
export function dimensionViews(metrics) {
  return Object.keys(metrics?.healthScores || {});
}

/**
 * Cards for one view. `overview` = every card, unchanged. A dimension view is a
 * pure filter of the same list by `category` — it can never surface a card that
 * `planCards` (and therefore the backend eligibility engine) did not produce.
 */
export function cardsForView(metrics, view) {
  const all = planCards(metrics);
  if (!view || view === OVERVIEW) return all;
  return all.filter((c) => c.category === view);
}
