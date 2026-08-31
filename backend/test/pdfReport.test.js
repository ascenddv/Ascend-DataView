/**
 * Phase 16 — the Overview PDF snapshot renders from a buildMetrics() payload,
 * is clearly stamped as point-in-time, degrades on no data / no insight, and
 * carries only what the given payload supports.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOverviewPdf } = require('../services/pdfReport');

const RICH = {
  dataset: { periodCount: 14, periods: ['2025-01-31', '2026-02-28'], latestPeriod: '2026-02-28', granularity: 'monthly' },
  kpis: [
    { key: 'revenue', label: 'Revenue', latest: 39669, growthRate: 0.062, vsTrailingAveragePct: 26.2 },
    { key: 'donors_total', label: 'Total donors', latest: 342, growthRate: 0.01, vsTrailingAveragePct: 4.1 },
  ],
  series: { revenue: [{ period: '2025-01-31', value: 22300 }, { period: '2026-02-28', value: 39669 }] },
  revenueByCategory: [
    { key: 'revenue_donations', label: 'Donations', value: 18000 },
    { key: 'revenue_grants', label: 'Grants', value: 12000 },
  ],
  healthScores: {
    Financial: { status: 'Available', score: 66, subScores: [{ key: 'revenue_growth' }, { key: 'expense_growth' }] },
    Growth: { status: 'Unavailable', score: null, reason: 'needs a native signal' },
    People: { status: 'Available', score: 52, subScores: [{ key: 'employee_growth' }] },
  },
  risksOpportunities: [
    { type: 'risk', key: 'cash_runway', title: 'Cash runway', detail: 'covers about 1.5 months' },
  ],
  cards: { KPI: 'Available', Trend: 'Available', BarComparison: 'Available', HealthScore: 'Limited', RiskOpportunity: 'Available' },
  confidence: {},
  trends: {},
};

// pdfkit writes text as kerned hex-string runs inside `[ ... ] TJ`. Rebuild the
// readable content by decoding every <hex> run (compression is off).
const pdfText = (buf) =>
  (buf.toString('latin1').match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join('');

test('produces a valid PDF buffer', async () => {
  const pdf = await buildOverviewPdf(RICH, null, { orgName: 'Helping Hands' });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.toString('latin1').slice(0, 5), '%PDF-');
  assert.ok(pdf.length > 1500);
});

test('is stamped as a point-in-time snapshot with the org name and generated time', async () => {
  const pdf = await buildOverviewPdf(RICH, null, { orgName: 'Helping Hands', generatedAt: '2026-08-30T12:00:00.000Z' });
  const t = pdfText(pdf);
  assert.match(t, /POINT-IN-TIME SNAPSHOT/);
  assert.match(t, /saved snapshot, not a live view/);
  assert.match(t, /Helping Hands/);
  assert.match(t, /August 30, 2026/);
});

test('renders exactly the sections the payload supports', async () => {
  const t = pdfText(await buildOverviewPdf(RICH, null, { orgName: 'Helping Hands' }));
  assert.match(t, /Financial health/);
  assert.match(t, /66 \/ 100/);
  assert.match(t, /Strong/); // 66 >= 64
  assert.match(t, /People health/);
  assert.match(t, /Stable/); // 52 is in [48,64)
  assert.doesNotMatch(t, /Growth health/); // Unavailable -> not in the snapshot
  assert.match(t, /Revenue/);
  assert.match(t, /Total donors/);
  assert.match(t, /vs its trailing average/);
  assert.match(t, /REVENUE BY SOURCE/i);
  assert.match(t, /Donations/);
  assert.match(t, /Cash runway/);
});

test('includes the AI insight when present', async () => {
  const pdf = await buildOverviewPdf(RICH, {
    status: 'ok',
    why: 'Revenue is increasing for the third consecutive month.',
    recommendation: 'Protect the largest funding source.',
  }, { orgName: 'Helping Hands' });
  const t = pdfText(pdf);
  assert.match(t, /third consecutive month/);
  assert.match(t, /Protect the largest funding source/);
});

test('degrades gracefully when the insight is unavailable', async () => {
  const t = pdfText(await buildOverviewPdf(RICH, { status: 'unavailable', why: null }, { orgName: 'Helping Hands' }));
  assert.match(t, /AI insight was not available/);
});

test('an org with no data still gets a valid, honest snapshot', async () => {
  const pdf = await buildOverviewPdf({ dataset: { periodCount: 0 }, cards: {} }, null, { orgName: 'Empty Org' });
  assert.equal(pdf.toString('latin1').slice(0, 5), '%PDF-');
  const t = pdfText(pdf);
  assert.match(t, /No data yet/);
  assert.match(t, /nothing to snapshot/);
  assert.doesNotMatch(t, /Health scores/i);
});

test('a sparse payload carries only its smaller section set', async () => {
  const sparse = {
    dataset: { periodCount: 3, periods: ['2025-01-31', '2025-03-31'], latestPeriod: '2025-03-31', granularity: 'monthly' },
    kpis: [{ key: 'revenue', label: 'Revenue', latest: 11900, growthRate: -0.03 }],
    series: {},
    revenueByCategory: [],
    healthScores: { Financial: { status: 'Available', score: 47, subScores: [{ key: 'revenue_growth' }] } },
    risksOpportunities: [{ type: 'risk', key: 'cash_runway', title: 'Cash runway', detail: 'about 1.4 months' }],
    cards: { KPI: 'Available', Trend: 'Limited', BarComparison: 'Unavailable', HealthScore: 'Limited', RiskOpportunity: 'Available' },
  };
  const t = pdfText(await buildOverviewPdf(sparse, null, { orgName: 'Tiny Org' }));
  assert.match(t, /Financial health/);
  assert.match(t, /Watch/); // 47 < 48
  assert.match(t, /Cash runway/);
  assert.doesNotMatch(t, /REVENUE BY SOURCE/i); // no categories
  assert.doesNotMatch(t, /TRENDS/); // Trend is Limited, not Available -> no section
  assert.doesNotMatch(t, /People health/); // sparse has no People data
});
