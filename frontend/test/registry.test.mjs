/**
 * planCards() against real /api/metrics payloads captured from the backend for
 * fixture_rich.csv and fixture_sparse.csv. Confirms the eligibility-driven card
 * list — nothing rendered that lacks data, and the graceful-degradation shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  planCards,
  cardsForView,
  dimensionViews,
  CARD_TYPES,
  OVERVIEW,
} from '../src/cards/registry.js';

const load = (name) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)))
  );

const rich = load('metrics_rich');
const sparse = load('metrics_sparse');
const richV2 = load('metrics_rich_v2'); // Phase 9: 8 health dimensions

const byType = (cards, type) => cards.filter((c) => c.type === type);

test('rich: all 3 health scores, KPIs, 3 trends, 1 bar, no risk cards', () => {
  const cards = planCards(rich);

  assert.deepEqual(
    byType(cards, CARD_TYPES.HEALTH).map((c) => c.props.dimension),
    ['Financial', 'Growth', 'Community']
  );
  assert.deepEqual(
    byType(cards, CARD_TYPES.KPI).map((c) => c.props.label),
    ['Revenue', 'Expenses', 'Cash balance', 'Total donors']
  );
  assert.deepEqual(
    byType(cards, CARD_TYPES.TREND).map((c) => c.props.label),
    ['Revenue', 'Expenses', 'Cash balance']
  );
  assert.equal(byType(cards, CARD_TYPES.BAR).length, 1);
  assert.equal(byType(cards, CARD_TYPES.RISK).length, 0);

  // priority order: health(1) before kpi(2) before trend/bar(3)
  const priorities = cards.map((c) => c.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));

  // no KPI is flagged limited (12 periods)
  assert.ok(byType(cards, CARD_TYPES.KPI).every((c) => c.props.limited === false));
});

test('sparse: only Financial health, 3 KPIs, no trend, no bar, 1 risk card', () => {
  const cards = planCards(sparse);

  assert.deepEqual(
    byType(cards, CARD_TYPES.HEALTH).map((c) => c.props.dimension),
    ['Financial']
  );
  assert.deepEqual(
    byType(cards, CARD_TYPES.KPI).map((c) => c.props.label),
    ['Revenue', 'Expenses', 'Cash balance']
  );
  assert.equal(byType(cards, CARD_TYPES.TREND).length, 0, 'Trend is Limited at 3 periods -> no card');
  assert.equal(byType(cards, CARD_TYPES.BAR).length, 0, 'no revenue subcategories -> no bar card');

  const risks = byType(cards, CARD_TYPES.RISK);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].props.type, 'risk');
  assert.match(risks[0].props.title, /[Cc]ash runway/);
});

test('sparse: Growth and Community are absent, not rendered as a low score', () => {
  const cards = planCards(sparse);
  const dims = byType(cards, CARD_TYPES.HEALTH).map((c) => c.props.dimension);
  assert.ok(!dims.includes('Growth'));
  assert.ok(!dims.includes('Community'));
});

test('empty dataset: no cards at all', () => {
  assert.deepEqual(planCards({ dataset: { periodCount: 0 }, cards: {} }), []);
  assert.deepEqual(planCards(null), []);
});

test('Phase 9: registry emits a health card for every scored dimension (8), no hardcoded list', () => {
  const cards = planCards(richV2);
  const healthDims = byType(cards, CARD_TYPES.HEALTH).map((c) => c.props.dimension);
  assert.deepEqual(healthDims, [
    'Financial', 'Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic',
  ]);
  // health cards come first, in the API's order
  assert.equal(cards.slice(0, 8).every((c) => c.type === CARD_TYPES.HEALTH), true);
});

/* ------------------------- Phase 11: per-dimension views ---------------- */

const DIMS = ['Financial', 'Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic'];

test('every card descriptor carries a category that is a known dimension', () => {
  for (const payload of [richV2, rich, sparse]) {
    for (const c of planCards(payload)) {
      assert.ok(DIMS.includes(c.category), `${c.key} has category "${c.category}"`);
    }
  }
});

test('Overview is unchanged — cardsForView(overview) deep-equals planCards', () => {
  assert.deepEqual(cardsForView(richV2, OVERVIEW), planCards(richV2));
  assert.deepEqual(cardsForView(sparse, OVERVIEW), planCards(sparse));
  assert.deepEqual(cardsForView(richV2, undefined), planCards(richV2));
});

test('a dimension view is a strict subset of the Overview card set — nothing invented', () => {
  for (const payload of [richV2, rich, sparse]) {
    const overviewKeys = new Set(planCards(payload).map((c) => c.key));
    for (const v of dimensionViews(payload)) {
      for (const c of cardsForView(payload, v)) {
        assert.ok(overviewKeys.has(c.key), `${v} view surfaced ${c.key}, not in Overview`);
        assert.equal(c.category, v);
      }
    }
  }
});

test('the dimension views partition the Overview cards (each card in exactly one view)', () => {
  const all = planCards(richV2);
  const perView = dimensionViews(richV2).flatMap((v) => cardsForView(richV2, v).map((c) => c.key));
  assert.deepEqual([...perView].sort(), all.map((c) => c.key).sort());
});

test('rich_v2 Financial view = health + financial KPIs + trends + bar', () => {
  const keys = cardsForView(richV2, 'Financial').map((c) => c.key).sort();
  assert.deepEqual(keys, [
    'bar-revenue-by-source',
    'health-Financial',
    'kpi-cash_balance',
    'kpi-expenses',
    'kpi-revenue',
    'trend-cash_balance',
    'trend-expenses',
    'trend-revenue',
  ]);
});

test('rich_v2 Community view carries the borrowed donors KPI alongside its health card', () => {
  assert.deepEqual(
    cardsForView(richV2, 'Community').map((c) => c.key).sort(),
    ['health-Community', 'kpi-donors_total']
  );
});

test('rich_v2 People view is just its health card (no KPI/trend/bar cards for that category)', () => {
  assert.deepEqual(cardsForView(richV2, 'People').map((c) => c.key), ['health-People']);
});

test('sparse data: new-dimension views are empty, nothing fabricated', () => {
  for (const v of ['Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic']) {
    assert.deepEqual(cardsForView(sparse, v), [], `${v} view should be empty for sparse data`);
  }
  // Financial still has its cards
  assert.ok(cardsForView(sparse, 'Financial').some((c) => c.key === 'health-Financial'));
});

test('no card descriptor carries a non-finite or nullish headline value', () => {
  for (const payload of [rich, sparse]) {
    for (const c of planCards(payload)) {
      const vals = Object.values(c.props).filter((v) => typeof v === 'number');
      assert.ok(
        vals.every(Number.isFinite),
        `${c.key} has a non-finite numeric prop: ${JSON.stringify(c.props)}`
      );
    }
  }
});
