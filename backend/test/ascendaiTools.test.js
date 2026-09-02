/**
 * AscendAI tools (Phase 18) — each tool returns correct data for a known
 * fixture dataset (via injected loadMetrics, no DB), and the sanitize guard the
 * chat loop relies on rejects a planted identifier-like key in a tool result.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMetrics } = require('../services/buildMetrics');
const { sanitizeForPrompt } = require('../services/generateInsight');
const {
  getHealthScore,
  getKpi,
  getRiskDetails,
  getTrend,
  getRevenueBySource,
  runTool,
} = require('../services/ascendai/tools');

/* --- a known fixture dataset (canonical keys, 7 monthly periods) ---------- */
const ROWS = [];
for (let i = 0; i < 7; i += 1) {
  const rev = 10000 + i * 700;
  ROWS.push({
    period_date: `2025-0${i + 1}-28`,
    revenue: rev,
    expenses: 9000 + i * 120,
    cash_balance: 20000 - i * 850, // declining -> cash runway risk fires by the end
    revenue_donations: Math.round(rev * 0.5),
    revenue_grants: Math.round(rev * 0.3),
    revenue_events: Math.round(rev * 0.15),
    revenue_other: rev - Math.round(rev * 0.5) - Math.round(rev * 0.3) - Math.round(rev * 0.15),
    donors_total: 100 + i * 5,
    donors_new: 10,
    donors_returning: 80 + i * 4,
    employees_total: 12 + i,
    employees_departed: 1,
  });
}
const ORG = 99;
const loadMetrics = async () => buildMetrics(ROWS);
const deps = { loadMetrics };
const LAST = ROWS[ROWS.length - 1];

test('getKpi returns the latest value, change and label for a real field', async () => {
  const r = await getKpi(ORG, { field: 'revenue' }, deps);
  assert.equal(r.field, 'revenue');
  assert.equal(r.label, 'Revenue');
  assert.equal(r.latest, LAST.revenue);
  assert.equal(r.previous, ROWS[ROWS.length - 2].revenue);
  assert.equal(typeof r.growthPct, 'number');
  assert.ok(r.dataConfidence && r.dataConfidence.tier);
});

test('getKpi rejects a field that is not a headline figure', async () => {
  const r = await getKpi(ORG, { field: 'volunteers_active' }, deps);
  assert.ok(r.error);
  assert.deepEqual(r.validFields, ['revenue', 'expenses', 'cash_balance', 'donors_total']);
});

test('getHealthScore returns score, band and the sub-metric breakdown', async () => {
  const r = await getHealthScore(ORG, { dimension: 'Financial' }, deps);
  assert.equal(r.status, 'Available');
  assert.equal(typeof r.score, 'number');
  assert.ok(['Watch', 'Stable', 'Strong'].includes(r.band));
  const keys = r.subMetrics.map((s) => s.metric);
  assert.deepEqual(keys.sort(), ['cash_balance_growth', 'expense_growth', 'revenue_growth']);
  const expense = r.subMetrics.find((s) => s.metric === 'expense_growth');
  assert.equal(expense.inverted, true, 'expense growth is an inverted sub-metric');
});

test('getHealthScore reports Unavailable (with a reason) for a dimension with no native data', async () => {
  const r = await getHealthScore(ORG, { dimension: 'Marketing' }, deps);
  assert.equal(r.status, 'Unavailable');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('getHealthScore rejects an unknown dimension', async () => {
  const r = await getHealthScore(ORG, { dimension: 'Vibes' }, deps);
  assert.ok(r.error);
  assert.ok(Array.isArray(r.validDimensions) && r.validDimensions.includes('Financial'));
});

test('getRiskDetails lists the fired rules with their triggering numbers', async () => {
  const r = await getRiskDetails(ORG, {}, deps);
  assert.ok(r.count >= 1);
  const runway = r.items.find((x) => x.key === 'cash_runway');
  assert.ok(runway, 'the declining-cash fixture fires the cash runway rule');
  assert.match(runway.detail, /months/);
  assert.equal(runway.type, 'risk');
});

test('getTrend returns the full series plus the first-to-latest change', async () => {
  const r = await getTrend(ORG, { metric: 'revenue' }, deps);
  assert.equal(r.periods, 7);
  assert.equal(r.series.length, 7);
  assert.equal(r.first, ROWS[0].revenue);
  assert.equal(r.latest, LAST.revenue);
  assert.ok(r.firstToLastGrowthPct > 0);
});

test('getTrend rejects an unknown metric', async () => {
  const r = await getTrend(ORG, { metric: 'karma' }, deps);
  assert.ok(r.error);
});

test('getRevenueBySource breaks the latest period down by share', async () => {
  const r = await getRevenueBySource(ORG, {}, deps);
  assert.equal(r.sources.length, 4);
  const shareSum = r.sources.reduce((s, x) => s + x.sharePct, 0);
  assert.ok(Math.abs(shareSum - 100) < 0.5, `shares sum to ~100 (got ${shareSum})`);
  assert.ok(r.largestSource.source && typeof r.largestSource.sharePct === 'number');
});

test('runTool dispatches by name and returns an error object for an unknown tool', async () => {
  const ok = await runTool('getKpi', { field: 'expenses' }, ORG, deps);
  assert.equal(ok.field, 'expenses');
  const bad = await runTool('getHoroscope', {}, ORG, deps);
  assert.ok(bad.error && /No such tool/.test(bad.error));
});

/* --- the guard the chat loop applies to every tool result ---------------- */

test('sanitizeForPrompt rejects a planted identifier-like key in a tool result', () => {
  assert.throws(
    () => sanitizeForPrompt({ dimension: 'Financial', score: 54, email: 'treasurer@example.org' }, '$.tool[getHealthScore]'),
    /identifier-like key "email"/
  );
  assert.throws(
    () => sanitizeForPrompt({ count: 1, items: [{ org_id: 7, detail: 'x' }] }, '$.tool[getRiskDetails]'),
    /identifier-like key "org_id"/
  );
});

test('sanitizeForPrompt leaves a clean tool result untouched', async () => {
  const clean = await getHealthScore(ORG, { dimension: 'Financial' }, deps);
  assert.deepEqual(sanitizeForPrompt(clean), clean);
});
