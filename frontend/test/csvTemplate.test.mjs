/** Phase 17 — the onboarding CSV template is built from the live schema. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplateCsv } from '../src/lib/csvTemplate.js';

const FIELDS = [
  { name: 'period_date', required: true, type: 'date' },
  { name: 'revenue', required: true, type: 'number' },
  { name: 'expenses', required: true, type: 'number' },
  { name: 'donors_total', required: false, type: 'number' },
];

test('the template header row is exactly the schema field names, in order', () => {
  const [header] = buildTemplateCsv(FIELDS).split('\n');
  assert.equal(header, 'period_date,revenue,expenses,donors_total');
});

test('the example row pre-fills the date column and leaves numbers blank', () => {
  const [, example] = buildTemplateCsv(FIELDS).split('\n');
  assert.equal(example, '2025-01-31,,,');
});

test('an empty schema still yields a well-formed (if empty) csv', () => {
  assert.equal(buildTemplateCsv([]), '\n\n');
});
