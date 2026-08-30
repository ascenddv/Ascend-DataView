/**
 * Sub-metric resolution: the dimension -> sub-metric mapping, the ">= 2 periods"
 * gate, the donor-retention-rate series, and the native-signal eligibility rule.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSubMetrics, HEALTH_DIMENSIONS } = require('../services/subMetrics');
const { FIELD_NAMES } = require('../config/schema');

// Minimal helper: a row with every schema field null, then overrides applied.
const row = (period, over = {}) => {
  const r = { period_date: period };
  for (const f of FIELD_NAMES) if (f !== 'period_date') r[f] = null;
  return { ...r, ...over };
};

test('financial-only data: Financial eligible, Growth & Community not', () => {
  const rows = [
    row('2025-01-31', { revenue: 18400, expenses: 17900, cash_balance: 26100 }),
    row('2025-02-28', { revenue: 19250, expenses: 18600, cash_balance: 26750 }),
    row('2025-03-31', { revenue: 17800, expenses: 18400, cash_balance: 26150 }),
  ];
  const { dimensions } = buildSubMetrics(rows);

  assert.equal(dimensions.Financial.eligible, true);
  assert.equal(dimensions.Financial.available.length, 3); // revenue, expense, cash growth

  // Growth has an available sub-metric (revenue growth) but it is borrowed, not native.
  assert.equal(dimensions.Growth.available.length, 1);
  assert.equal(dimensions.Growth.available[0].key, 'revenue_growth');
  assert.equal(dimensions.Growth.available[0].native, false);
  assert.equal(dimensions.Growth.eligible, false);
  assert.match(dimensions.Growth.reason, /native signal/);

  assert.equal(dimensions.Community.available.length, 0);
  assert.equal(dimensions.Community.eligible, false);
});

test('expense growth carries the inverted flag', () => {
  const rows = [
    row('2025-01-31', { revenue: 100, expenses: 100, cash_balance: 100 }),
    row('2025-02-28', { revenue: 110, expenses: 90, cash_balance: 120 }),
  ];
  const { dimensions } = buildSubMetrics(rows);
  const expense = dimensions.Financial.available.find((s) => s.key === 'expense_growth');
  assert.equal(expense.inverted, true);
  assert.equal(expense.growthRate, -0.1); // (90-100)/100
});

test('Growth becomes eligible once a native field (web/social) is present', () => {
  const rows = [
    row('2025-01-31', { revenue: 100, expenses: 90, cash_balance: 100, website_visitors: 1000, social_followers: 500 }),
    row('2025-02-28', { revenue: 120, expenses: 95, cash_balance: 110, website_visitors: 1200, social_followers: 550 }),
  ];
  const { dimensions } = buildSubMetrics(rows);
  assert.equal(dimensions.Growth.eligible, true);
  const keys = dimensions.Growth.available.map((s) => s.key).sort();
  assert.deepEqual(keys, ['revenue_growth', 'social_follower_growth', 'website_visitor_growth']);
  // revenue growth still contributes to the score, just doesn't confer eligibility
  assert.equal(dimensions.Growth.available.find((s) => s.key === 'revenue_growth').native, false);
});

test('donor retention rate growth needs three periods of donors_total', () => {
  const two = [
    row('2025-01-31', { revenue: 1, expenses: 1, cash_balance: 1, donors_total: 100, donors_returning: 80 }),
    row('2025-02-28', { revenue: 1, expenses: 1, cash_balance: 1, donors_total: 110, donors_returning: 88 }),
  ];
  assert.equal(
    buildSubMetrics(two).dimensions.Community.available.some((s) => s.key === 'donor_retention_rate_growth'),
    false
  );

  const three = [
    ...two,
    row('2025-03-31', { revenue: 1, expenses: 1, cash_balance: 1, donors_total: 120, donors_returning: 99 }),
  ];
  const community = buildSubMetrics(three).dimensions.Community;
  const retention = community.available.find((s) => s.key === 'donor_retention_rate_growth');
  assert.ok(retention, 'retention sub-metric should now be available');
  // rateNow = 99/110 = 0.9 ; ratePrev = 88/100 = 0.88 ; growth = (0.9-0.88)/0.88
  assert.ok(Math.abs(retention.growthRate - (0.9 - 0.88) / 0.88) < 1e-9);
  assert.equal(retention.native, true);
  assert.equal(community.eligible, true);
});

test('a sub-metric with a zero base is treated as unavailable, not Infinity', () => {
  const rows = [
    row('2025-01-31', { revenue: 0, expenses: 100, cash_balance: 100 }),
    row('2025-02-28', { revenue: 500, expenses: 110, cash_balance: 120 }),
  ];
  const { dimensions } = buildSubMetrics(rows);
  assert.equal(dimensions.Financial.available.some((s) => s.key === 'revenue_growth'), false);
  assert.equal(dimensions.Financial.available.length, 2); // expense + cash only
});

/* --------------------------- Phase 9: new dimensions ---------------------- */

test('buildSubMetrics is data-driven from HEALTH_DIMENSIONS (8 dims as of Phase 9)', () => {
  assert.equal(HEALTH_DIMENSIONS.length, 8);
  const { dimensions } = buildSubMetrics([]);
  assert.deepEqual(Object.keys(dimensions).sort(), [...HEALTH_DIMENSIONS].sort());
});

test('financial-only data: all 5 new dimensions Unavailable, score never fabricated', () => {
  const rows = [
    row('2025-01-31', { revenue: 100, expenses: 90, cash_balance: 100 }),
    row('2025-02-28', { revenue: 110, expenses: 92, cash_balance: 110 }),
    row('2025-03-31', { revenue: 120, expenses: 95, cash_balance: 120 }),
  ];
  const { dimensions } = buildSubMetrics(rows);
  for (const d of ['People', 'Marketing', 'Fundraising', 'Impact', 'Strategic']) {
    assert.equal(dimensions[d].available.length, 0, `${d} should have no available sub-metrics`);
    assert.equal(dimensions[d].eligible, false, `${d} must not be eligible`);
  }
});

test('People: eligible with employee data; turnover rate carries the inverted flag', () => {
  const rows = [
    row('2025-01-31', { revenue: 1, expenses: 1, cash_balance: 1, employees_total: 20, employees_departed: 2 }),
    row('2025-02-28', { revenue: 1, expenses: 1, cash_balance: 1, employees_total: 22, employees_departed: 2 }),
    row('2025-03-31', { revenue: 1, expenses: 1, cash_balance: 1, employees_total: 25, employees_departed: 3 }),
  ];
  const people = buildSubMetrics(rows).dimensions.People;
  assert.equal(people.eligible, true);
  const emp = people.available.find((s) => s.key === 'employee_growth');
  const turn = people.available.find((s) => s.key === 'turnover_rate_growth');
  assert.ok(emp && emp.native);
  assert.ok(turn && turn.native);
  assert.equal(turn.inverted, true);
  // rate now = 3/25 = 0.12 ; prev = 2/22 ; growth = (0.12 - 2/22) / (2/22)
  const expected = (3 / 25 - 2 / 22) / (2 / 22);
  assert.ok(Math.abs(turn.growthRate - expected) < 1e-9);
});

test('Marketing: borrowed spend-efficiency alone does NOT confer eligibility; a native email signal does', () => {
  // revenue + marketing_spend present (efficiency computable) but no email fields
  const borrowedOnly = [
    row('2025-01-31', { revenue: 100, expenses: 1, cash_balance: 1, marketing_spend: 10 }),
    row('2025-02-28', { revenue: 120, expenses: 1, cash_balance: 1, marketing_spend: 11 }),
  ];
  const m1 = buildSubMetrics(borrowedOnly).dimensions.Marketing;
  assert.equal(m1.available.some((s) => s.key === 'marketing_spend_efficiency_growth'), true);
  assert.equal(m1.available.every((s) => s.native === false), true);
  assert.equal(m1.eligible, false);
  assert.match(m1.reason, /native signal/);

  const withEmail = borrowedOnly.map((r, i) => ({ ...r, email_subscribers: 1000 + i * 100 }));
  const m2 = buildSubMetrics(withEmail).dimensions.Marketing;
  assert.equal(m2.eligible, true);
  assert.equal(m2.available.find((s) => s.key === 'email_subscriber_growth').native, true);
});

test('Fundraising & Impact: borrowed donor / participant growth cannot make them eligible alone', () => {
  const rows = [
    row('2025-01-31', { revenue: 1, expenses: 1, cash_balance: 1, donors_total: 100, program_participants: 50 }),
    row('2025-02-28', { revenue: 1, expenses: 1, cash_balance: 1, donors_total: 110, program_participants: 55 }),
  ];
  const { dimensions } = buildSubMetrics(rows);
  assert.equal(dimensions.Fundraising.available.length, 1); // donor_growth, borrowed
  assert.equal(dimensions.Fundraising.available[0].native, false);
  assert.equal(dimensions.Fundraising.eligible, false);
  assert.equal(dimensions.Impact.available.length, 1); // program_participant_growth, borrowed
  assert.equal(dimensions.Impact.available[0].native, false);
  assert.equal(dimensions.Impact.eligible, false);
});

test('Strategic: single native ratio sub-metric is enough to score', () => {
  const rows = [
    row('2025-01-31', { revenue: 1, expenses: 1, cash_balance: 1, goals_total: 10, goals_completed: 3 }),
    row('2025-02-28', { revenue: 1, expenses: 1, cash_balance: 1, goals_total: 10, goals_completed: 5 }),
  ];
  const strat = buildSubMetrics(rows).dimensions.Strategic;
  assert.equal(strat.eligible, true);
  const g = strat.available.find((s) => s.key === 'goal_completion_rate_growth');
  assert.ok(g && g.native && g.inverted === false);
  assert.ok(Math.abs(g.growthRate - (0.5 - 0.3) / 0.3) < 1e-9); // 3/10 -> 5/10
});
