/**
 * generateInsight() — the PII guard clause, the prompt-input projection, and the
 * narrate-don't-compute contract. No real network: a fake completeJson is
 * injected so these assert the boundary behavior, not the model.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateInsight,
  sanitizeForPrompt,
  toNarrationInput,
} = require('../services/generateInsight');

/* --- a realistic buildMetrics()-shaped payload ------------------------------ */
function metricsFixture(over = {}) {
  return {
    dataset: {
      periodCount: 12,
      periods: ['2025-01-31', '2025-12-31'],
      latestPeriod: '2025-12-31',
      granularity: 'monthly',
    },
    kpis: [
      { key: 'revenue', label: 'Revenue', latest: 34600, previous: 31200, change: 3400, growthRate: 0.109 },
    ],
    series: { revenue: [{ period: '2025-01-31', value: 15200 }] },
    revenueByCategory: [{ key: 'revenue_grants', label: 'Grants', value: 11500 }],
    healthScores: {
      Financial: {
        dimension: 'Financial',
        status: 'Available',
        score: 54,
        subScores: [{ key: 'revenue_growth', growthRate: 0.109, inverted: false, subScore: 60.9 }],
      },
      Growth: { dimension: 'Growth', status: 'Unavailable', score: null, reason: 'needs a native signal' },
      Community: { dimension: 'Community', status: 'Available', score: 55, subScores: [] },
    },
    risksOpportunities: [
      { type: 'risk', key: 'cash_runway', title: 'Cash runway', detail: 'covers about 1.4 months', metricValue: 1.43 },
    ],
    cards: { KPI: 'Available', Trend: 'Available', BarComparison: 'Available', HealthScore: 'Available', RiskOpportunity: 'Available' },
    ...over,
  };
}

/* --- PII / raw-row guard --------------------------------------------------- */

test('sanitizeForPrompt: throws on an identifier-like key anywhere in the tree', () => {
  assert.throws(
    () => sanitizeForPrompt({ healthScores: { Financial: { donor_name: 'Jane Roe' } } }),
    /identifier-like key "donor_name"/
  );
  assert.throws(() => sanitizeForPrompt({ email: 'x@y.com' }), /identifier-like key "email"/);
});

test('sanitizeForPrompt: rejects Phase 8 auth / org metadata keys', () => {
  for (const key of ['password_hash', 'org_name', 'org_id', 'organization', 'role', 'token']) {
    assert.throws(
      () => sanitizeForPrompt({ healthScores: { Financial: { [key]: 'x' } } }),
      new RegExp(`identifier-like key "${key}"`),
      `key "${key}" should be rejected`
    );
  }
});

test('sanitizeForPrompt: a real buildMetrics-shaped payload is not falsely flagged', () => {
  const m = metricsFixture();
  assert.doesNotThrow(() => sanitizeForPrompt(m));
});

test('sanitizeForPrompt: throws if a raw ingested row is passed instead of metrics', () => {
  assert.throws(
    () => sanitizeForPrompt({ rows: [{ period_date: '2025-01-31', revenue: 100 }] }),
    /looks like a raw ingested row/
  );
  assert.throws(
    () => sanitizeForPrompt([{ period_date: '2025-01-31', source_meta: {} }]),
    /raw ingested row/
  );
});

test('sanitizeForPrompt: redacts free-text values that match a PII pattern', () => {
  const cleaned = sanitizeForPrompt({
    risksOpportunities: [
      { type: 'risk', detail: 'flagged by treasurer jane@example.org, call 415-555-0142' },
    ],
  });
  assert.equal(cleaned.risksOpportunities[0].detail, '[redacted]');
});

test('sanitizeForPrompt: leaves a clean metrics payload untouched', () => {
  const m = metricsFixture();
  assert.deepEqual(sanitizeForPrompt(m), m);
});

test('sanitizeForPrompt: an ISO period date is not mistaken for PII', () => {
  const cleaned = sanitizeForPrompt({ periods: ['2025-03-31', '2025-04-30'] });
  assert.deepEqual(cleaned.periods, ['2025-03-31', '2025-04-30']);
});

/* --- prompt-input projection ------------------------------------------------ */

test('toNarrationInput: drops per-period series, keeps computed aggregates verbatim', () => {
  const n = toNarrationInput(metricsFixture());
  assert.equal(n.series, undefined);
  assert.equal(n.healthScores.Financial.score, 54);
  assert.equal(n.healthScores.Growth.status, 'Unavailable');
  assert.equal(n.risksOpportunities[0].detail, 'covers about 1.4 months');
  assert.equal(n.risksOpportunities[0].metricValue, 1.43);
  assert.equal(n.kpis[0].growthRatePct, 10.9);
});

/* --- generateInsight orchestration --------------------------------------- */

test('generateInsight: no data -> unavailable, and the model is never called', async () => {
  let called = false;
  const res = await generateInsight(
    { dataset: { periodCount: 0 } },
    { completeJson: async () => ((called = true), {}) }
  );
  assert.equal(res.status, 'unavailable');
  assert.equal(res.why, null);
  assert.equal(called, false);
});

test('generateInsight: returns the model\'s why + recommendation, trimmed', async () => {
  const res = await generateInsight(metricsFixture(), {
    completeJson: async () => ({
      why: '  Revenue grew 10.9% ...  ',
      recommendation: ' Keep 3 months of runway. ',
    }),
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.why, 'Revenue grew 10.9% ...');
  assert.equal(res.recommendation, 'Keep 3 months of runway.');
});

test('generateInsight: throws if the model omits a required field', async () => {
  await assert.rejects(
    generateInsight(metricsFixture(), { completeJson: async () => ({ why: 'only why' }) }),
    /missing "why" or "recommendation"/
  );
});

test('generateInsight: the prompt carries the real computed numbers, no raw rows', async () => {
  let seenPrompt = '';
  await generateInsight(metricsFixture(), {
    completeJson: async (prompt) => {
      seenPrompt = prompt;
      return { why: 'x', recommendation: 'y' };
    },
  });
  assert.match(seenPrompt, /"score": 54/);
  assert.match(seenPrompt, /covers about 1\.4 months/);
  assert.match(seenPrompt, /"growthRatePct": 10\.9/);
  assert.doesNotMatch(seenPrompt, /period_date/); // series / raw rows never sent
});

test('generateInsight: a planted identifier key is refused before any model call', async () => {
  let called = false;
  await assert.rejects(
    generateInsight(metricsFixture({ healthScores: { Financial: { email: 'a@b.com' } } }), {
      completeJson: async () => ((called = true), { why: 'x', recommendation: 'y' }),
    }),
    /identifier-like key "email"/
  );
  assert.equal(called, false);
});
