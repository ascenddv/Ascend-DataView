/**
 * Phase 9 gate — run /api/metrics for the extended rich fixture and the Stage 1
 * sparse fixture, and show all 8 health dimensions side by side.
 *
 *   node scripts/phase9-gate.mjs <baseUrl> <repoRoot>
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

function makeClient() {
  let cookie = null;
  return async (method, urlPath, { body, form } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + urlPath, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

function fixtureForm(name) {
  const fd = new FormData();
  const buf = readFileSync(path.join(ROOT, 'data', name));
  fd.append('file', new Blob([buf], { type: 'text/csv' }), name);
  return fd;
}

async function uploadAndGetMetrics(label, fixtureFile) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const req = makeClient();
  await req('POST', '/api/auth/signup', {
    body: { email: `p9_${label}_${stamp}@test.com`, password: 'password123', orgName: `P9 ${label} ${stamp}` },
  });
  const up = await req('POST', '/api/upload', { form: fixtureForm(fixtureFile) });
  const m = await req('GET', '/api/metrics');
  return { upload: up.json, metrics: m.json };
}

function dimTable(healthScores) {
  const rows = Object.entries(healthScores).map(([dim, h]) => {
    if (h.status === 'Available') {
      return `  ${dim.padEnd(12)} ${String(h.score).padStart(3)}   ${h.availableSubMetrics.join(', ')}`;
    }
    return `  ${dim.padEnd(12)}  U    (${h.reason})`;
  });
  return rows.join('\n');
}

const rich = await uploadAndGetMetrics('rich', 'fixture_rich_v2.csv');
const sparse = await uploadAndGetMetrics('sparse', 'fixture_sparse.csv');

let failures = 0;
const check = (label, cond) => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

console.log('\n================ fixture_rich_v2.csv ================');
console.log(`upload: ${rich.upload.rowsStored} rows stored, ${rich.upload.rowsSkipped} skipped, mapping via ${rich.upload.mappingFromCache ? 'cache' : rich.upload.llmUsed ? 'LLM' : 'exact match'}`);
console.log(`periods: ${rich.metrics.dataset.periodCount}\n`);
console.log('  DIMENSION    SCORE  SUB-METRICS');
console.log(dimTable(rich.metrics.healthScores));
console.log(`\n  HealthScore card: ${rich.metrics.cards.HealthScore}`);

const ALL8 = ['Financial', 'Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic'];
console.log('\n  checks:');
for (const d of ALL8) {
  const h = rich.metrics.healthScores[d];
  check(`${d} scores (Available, numeric)`, h && h.status === 'Available' && typeof h.score === 'number' && h.score >= 0 && h.score <= 100);
}
check('turnover_rate_growth is inverted in the People sub-scores', () => true === (rich.metrics.healthScores.People.subScores.find((s) => s.key === 'turnover_rate_growth')?.inverted === true));
const turn = rich.metrics.healthScores.People.subScores.find((s) => s.key === 'turnover_rate_growth');
check('turnover sub-score reflects inversion (raw growthRate and effective have opposite sign)', turn && Math.sign(turn.growthRate) === -Math.sign(turn.effectiveGrowthRate));
check('marketing_spend_efficiency is marked borrowed (native:false)', rich.metrics.healthScores.Marketing.subScores.find((s) => s.key === 'marketing_spend_efficiency_growth')?.native === false);
check('Fundraising donor_growth is borrowed (native:false)', rich.metrics.healthScores.Fundraising.subScores.find((s) => s.key === 'donor_growth')?.native === false);

console.log('\n================ fixture_sparse.csv (Stage 1, no new fields) ================');
console.log(`periods: ${sparse.metrics.dataset.periodCount}\n`);
console.log('  DIMENSION    SCORE  SUB-METRICS / REASON');
console.log(dimTable(sparse.metrics.healthScores));
console.log(`\n  HealthScore card: ${sparse.metrics.cards.HealthScore}`);

console.log('\n  checks:');
check('Financial still scores', sparse.metrics.healthScores.Financial.status === 'Available');
for (const d of ['Growth', 'Community', 'People', 'Marketing', 'Fundraising', 'Impact', 'Strategic']) {
  const h = sparse.metrics.healthScores[d];
  check(`${d} = Unavailable with score:null (not fabricated)`, h && h.status === 'Unavailable' && h.score === null && h.scoreExact === null);
}

console.log(`\n${failures === 0 ? 'ALL PHASE 9 CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
