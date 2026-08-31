/**
 * Per-card confidence tier (Phase 14a): weakest-link across every field and
 * period feeding a card, driven by source_meta mapping confidence, the
 * subcategory reconciliation check, and source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { cardConfidence, fieldMappingTier, TIERS } = require('../services/confidence');

const META_EXACT = {
  source: 'csv_upload',
  mapping_confidence: { revenue: 1, expenses: 1, cash_balance: 1 },
  mapping_confirmed: {},
};
const META_MANUAL = { source: 'manual_entry', mapping_confidence: {}, mapping_confirmed: {} };

function row(period, values, meta = META_EXACT) {
  return { period_date: period, ...values, source_meta: meta };
}

test('exact-match and manual-entry fields are High', () => {
  assert.equal(fieldMappingTier(row('2025-01-31', { revenue: 100 }), 'revenue').tier, TIERS.HIGH);
  assert.equal(
    fieldMappingTier(row('2025-01-31', { revenue: 100 }, META_MANUAL), 'revenue').tier,
    TIERS.HIGH
  );
});

test('a below-threshold mapping is Low while unconfirmed, Medium once confirmed', () => {
  const unconfirmed = row('2025-01-31', { revenue: 100 }, {
    source: 'csv_upload',
    mapping_confidence: { revenue: 0.55 },
    mapping_confirmed: {},
  });
  assert.equal(fieldMappingTier(unconfirmed, 'revenue').tier, TIERS.LOW);

  const confirmed = row('2025-01-31', { revenue: 100 }, {
    source: 'csv_upload',
    mapping_confidence: { revenue: 0.55 },
    mapping_confirmed: { revenue: true },
  });
  assert.equal(fieldMappingTier(confirmed, 'revenue').tier, TIERS.MEDIUM);
});

test('pre-Phase-14 rows with no source_meta do not drag a card down', () => {
  const legacy = { period_date: '2025-01-31', revenue: 100 };
  assert.equal(fieldMappingTier(legacy, 'revenue').tier, TIERS.HIGH);
});

test('card tier is the weakest link, not an average', () => {
  const rows = [
    row('2025-01-31', { revenue: 100, expenses: 90, cash_balance: 500 }),
    row('2025-02-28', { revenue: 110, expenses: 92, cash_balance: 520 }, {
      source: 'csv_upload',
      mapping_confidence: { revenue: 1, expenses: 0.5, cash_balance: 1 },
      mapping_confirmed: {},
    }),
  ];
  const c = cardConfidence({
    fields: ['revenue', 'expenses', 'cash_balance'],
    rows,
    periods: ['2025-01-31', '2025-02-28'],
  });
  assert.equal(c.tier, TIERS.LOW); // one 0.5 expenses cell drags the whole card
  assert.ok(c.reasons.some((r) => r.includes('expenses')));
});

test('periods outside the feeding window are ignored', () => {
  const rows = [
    row('2025-01-31', { revenue: 50 }, {
      source: 'csv_upload',
      mapping_confidence: { revenue: 0.4 },
      mapping_confirmed: {},
    }),
    row('2025-02-28', { revenue: 100 }),
    row('2025-03-31', { revenue: 120 }),
  ];
  // A KPI only draws on the last two periods -> the shaky Jan cell is not in scope.
  const kpi = cardConfidence({ fields: ['revenue'], rows, periods: ['2025-02-28', '2025-03-31'] });
  assert.equal(kpi.tier, TIERS.HIGH);
  // A trend draws on the whole series -> Jan is in scope and drags it to Low.
  const trend = cardConfidence({ fields: ['revenue'], rows });
  assert.equal(trend.tier, TIERS.LOW);
});

test('a revenue subcategory that does not reconcile caps the card at Medium', () => {
  const rows = [
    row('2025-01-31', {
      revenue: 100,
      revenue_donations: 40,
      revenue_grants: 40,
      revenue_events: 40,
      revenue_other: 40, // sums to 160, not 100
    }),
  ];
  const c = cardConfidence({
    fields: ['revenue', 'revenue_donations', 'revenue_grants', 'revenue_events', 'revenue_other'],
    rows,
    periods: ['2025-01-31'],
  });
  assert.equal(c.tier, TIERS.MEDIUM);
  assert.ok(c.reasons.some((r) => r.includes('did not add up')));
});

test('a fully clean card reports High with a single plain-language reason', () => {
  const rows = [
    row('2025-01-31', { revenue: 100 }),
    row('2025-02-28', { revenue: 110 }),
  ];
  const c = cardConfidence({ fields: ['revenue'], rows, periods: ['2025-01-31', '2025-02-28'] });
  assert.equal(c.tier, TIERS.HIGH);
  assert.equal(c.reasons.length, 1);
  assert.doesNotMatch(c.reasons[0], /\d/); // no raw numbers in the explanation
});
