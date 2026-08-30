/**
 * The 4 deterministic risk/opportunity rules — each with a firing case, a
 * non-firing case, and a not-enough-data case.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateRiskRules,
  fundingConcentrationRisk,
  cashRunwayRisk,
  revenueDeclineRisk,
  donorRetentionOpportunity,
} = require('../services/riskRules');

const row = (period, over = {}) => ({
  period_date: period,
  revenue: null,
  expenses: null,
  cash_balance: null,
  revenue_donations: null,
  revenue_grants: null,
  revenue_events: null,
  revenue_other: null,
  donors_total: null,
  donors_returning: null,
  volunteers_active: null,
  program_participants: null,
  ...over,
});

/* --------------------------- funding concentration ------------------------ */

test('fundingConcentrationRisk: fires when a subcategory exceeds 50% of revenue', () => {
  const rows = [row('2025-01-31', { revenue: 10000, revenue_grants: 6000, revenue_donations: 4000 })];
  const r = fundingConcentrationRisk(rows);
  assert.equal(r.type, 'risk');
  assert.equal(r.key, 'funding_concentration');
  assert.equal(r.metricValue, 0.6);
});

test('fundingConcentrationRisk: does not fire when all subcategories are <= 50%', () => {
  const rows = [row('2025-01-31', { revenue: 10000, revenue_grants: 5000, revenue_donations: 5000 })];
  assert.equal(fundingConcentrationRisk(rows), undefined);
});

test('fundingConcentrationRisk: cannot evaluate without revenue subcategories', () => {
  const rows = [row('2025-01-31', { revenue: 10000 })];
  assert.equal(fundingConcentrationRisk(rows), undefined);
});

/* ------------------------------- cash runway ---------------------------- */

test('cashRunwayRisk: fires when cash covers < 3 months of avg expenses', () => {
  const rows = [
    row('2025-01-31', { expenses: 1000, cash_balance: 5000 }),
    row('2025-02-28', { expenses: 1000, cash_balance: 4000 }),
    row('2025-03-31', { expenses: 1000, cash_balance: 2500 }), // 2.5 months
  ];
  const r = cashRunwayRisk(rows);
  assert.equal(r.key, 'cash_runway');
  assert.equal(r.metricValue, 2.5);
});

test('cashRunwayRisk: does not fire at >= 3 months of runway', () => {
  const rows = [
    row('2025-01-31', { expenses: 1000, cash_balance: 5000 }),
    row('2025-02-28', { expenses: 1000, cash_balance: 4000 }),
    row('2025-03-31', { expenses: 1000, cash_balance: 3000 }), // exactly 3 months
  ];
  assert.equal(cashRunwayRisk(rows), undefined);
});

test('cashRunwayRisk: cannot evaluate without expenses history', () => {
  const rows = [row('2025-01-31', { cash_balance: 1000 })];
  assert.equal(cashRunwayRisk(rows), undefined);
});

/* ----------------------------- revenue decline ------------------------- */

test('revenueDeclineRisk: fires when revenue growth < -10%', () => {
  const rows = [
    row('2025-01-31', { revenue: 10000 }),
    row('2025-02-28', { revenue: 8500 }), // -15%
  ];
  const r = revenueDeclineRisk(rows);
  assert.equal(r.key, 'revenue_decline');
  assert.ok(Math.abs(r.metricValue - -0.15) < 1e-9);
});

test('revenueDeclineRisk: does not fire at a -5% dip', () => {
  const rows = [
    row('2025-01-31', { revenue: 10000 }),
    row('2025-02-28', { revenue: 9500 }),
  ];
  assert.equal(revenueDeclineRisk(rows), undefined);
});

test('revenueDeclineRisk: cannot evaluate with a single period', () => {
  assert.equal(revenueDeclineRisk([row('2025-01-31', { revenue: 10000 })]), undefined);
});

/* ------------------------- donor retention opportunity ----------------- */

test('donorRetentionOpportunity: fires when retention rate improves > 10 pp', () => {
  const rows = [
    row('2025-01-31', { donors_total: 100, donors_returning: 70 }),
    row('2025-02-28', { donors_total: 100, donors_returning: 70 }), // ratePrev = 70/100 = 0.70
    row('2025-03-31', { donors_total: 100, donors_returning: 85 }), // rateNow  = 85/100 = 0.85
  ];
  const r = donorRetentionOpportunity(rows);
  assert.equal(r.type, 'opportunity');
  assert.equal(r.key, 'donor_retention');
  assert.ok(Math.abs(r.metricValue - 0.15) < 1e-9);
});

test('donorRetentionOpportunity: does not fire on a 5 pp improvement', () => {
  const rows = [
    row('2025-01-31', { donors_total: 100, donors_returning: 70 }),
    row('2025-02-28', { donors_total: 100, donors_returning: 70 }),
    row('2025-03-31', { donors_total: 100, donors_returning: 75 }),
  ];
  assert.equal(donorRetentionOpportunity(rows), undefined);
});

test('donorRetentionOpportunity: cannot evaluate with fewer than 3 periods', () => {
  const rows = [
    row('2025-01-31', { donors_total: 100, donors_returning: 70 }),
    row('2025-02-28', { donors_total: 100, donors_returning: 85 }),
  ];
  assert.equal(donorRetentionOpportunity(rows), undefined);
});

/* -------------------------------- aggregate --------------------------- */

test('evaluateRiskRules: returns only fired rules, in rule order', () => {
  const rows = [
    row('2025-01-31', { revenue: 10000, expenses: 1000, cash_balance: 5000 }),
    row('2025-02-28', { revenue: 10000, expenses: 1000, cash_balance: 4000 }),
    row('2025-03-31', {
      revenue: 8000, // -20% decline
      expenses: 1000,
      cash_balance: 2000, // 2 months runway
      revenue_grants: 5000, // 62.5% concentration
      revenue_donations: 3000,
    }),
  ];
  const fired = evaluateRiskRules(rows);
  assert.deepEqual(
    fired.map((f) => f.key),
    ['funding_concentration', 'cash_runway', 'revenue_decline']
  );
});

test('evaluateRiskRules: empty dataset returns []', () => {
  assert.deepEqual(evaluateRiskRules([]), []);
});
