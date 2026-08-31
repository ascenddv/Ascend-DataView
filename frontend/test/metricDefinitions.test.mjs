/**
 * Phase 14c — metric definitions are a single source of truth, read as general
 * guidance (never an implied benchmark against other organizations).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { METRIC_DEFINITIONS, definitionFor } from '../src/lib/metricDefinitions.js';

const HEALTH_DIMS = [
  'Financial', 'Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic',
];

test('every health dimension has a definition and a typical-range note', () => {
  for (const dim of HEALTH_DIMS) {
    const d = METRIC_DEFINITIONS.health[dim];
    assert.ok(d, `missing health definition for ${dim}`);
    assert.ok(d.title && d.definition && d.typicalRange, `${dim} definition is incomplete`);
  }
});

test('definitionFor resolves one representative card of each type', () => {
  const cases = [
    { type: 'health', key: 'health-Financial', category: 'Financial' },
    { type: 'kpi', key: 'kpi-revenue' },
    { type: 'trend', key: 'trend-cash_balance' },
    { type: 'bar', key: 'bar-revenue-by-source' },
    { type: 'risk', key: 'risk-cash_runway' },
  ];
  for (const c of cases) {
    const d = definitionFor(c);
    assert.ok(d && d.title && d.definition, `no definition for ${c.key}`);
  }
});

test('definitionFor invents nothing for an unknown metric or type', () => {
  assert.equal(definitionFor({ type: 'kpi', key: 'kpi-nonexistent_field' }), null);
  assert.equal(definitionFor({ type: 'mystery', key: 'x-y' }), null);
  assert.equal(definitionFor(null), null);
});

test('a health card with an unknown dimension falls back to the generic definition', () => {
  const d = definitionFor({ type: 'health', key: 'health-Weird', category: 'Weird' });
  assert.equal(d, METRIC_DEFINITIONS.health._default);
});

test('no copy implies a real peer/benchmark comparison', () => {
  const all = [
    ...Object.values(METRIC_DEFINITIONS.health),
    ...Object.values(METRIC_DEFINITIONS.metric),
    ...Object.values(METRIC_DEFINITIONS.risk),
  ]
    .flatMap((d) => [d.definition, d.typicalRange])
    .filter(Boolean)
    .join(' ');

  assert.doesNotMatch(all, /\bpeers?\b/i);
  assert.doesNotMatch(all, /\bbenchmark/i);
  assert.doesNotMatch(all, /average (nonprofit|organization|org)\b/i);
  assert.doesNotMatch(all, /compared to other (nonprofit|organization)/i);
});
