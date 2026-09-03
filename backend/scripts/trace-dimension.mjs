/**
 * Show the raw period-over-period numbers feeding Marketing & Fundraising scores
 * for fixture_rich_v2.csv, so a near-neutral score can be traced to the data.
 *
 *   node scripts/trace-dimension.mjs <baseUrl> <repoRoot>
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

let cookie;
async function req(method, p, { body, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

const stamp = Date.now();
await req('POST', '/api/auth/signup', {
  body: { email: `trace_${stamp}@test.com`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `Trace ${stamp}` },
});
const fd = new FormData();
fd.append(
  'file',
  new Blob([readFileSync(path.join(ROOT, 'data', 'fixture_rich_v2.csv'))], { type: 'text/csv' }),
  'fixture_rich_v2.csv'
);
await req('POST', '/api/upload', { form: fd });

const { json: data } = await req('GET', '/api/data');
const { json: metrics } = await req('GET', '/api/metrics');
const rows = data.rows; // sorted ascending by period

const col = (f) => rows.map((r) => r[f]);
const last = (a) => a[a.length - 1];
const prev = (a) => a[a.length - 2];
const pct = (x) => (x * 100).toFixed(2) + '%';

console.log('periods:', rows.map((r) => r.period_date.slice(0, 7)).join('  '));

console.log('\n=================== MARKETING (score ' + metrics.healthScores.Marketing.score + ') ===================');
console.log('email_subscribers :', col('email_subscribers').join(', '));
console.log('email_open_rate   :', col('email_open_rate').join(', '));
console.log('revenue           :', col('revenue').join(', '));
console.log('marketing_spend   :', col('marketing_spend').join(', '));
console.log('\nlast two periods (Nov -> Dec):');
console.log(`  email_subscribers:  ${prev(col('email_subscribers'))} -> ${last(col('email_subscribers'))}   PoP growth ${pct((last(col('email_subscribers')) - prev(col('email_subscribers'))) / prev(col('email_subscribers')))}`);
console.log(`  email_open_rate:     ${prev(col('email_open_rate'))} -> ${last(col('email_open_rate'))}   PoP growth ${pct((last(col('email_open_rate')) - prev(col('email_open_rate'))) / prev(col('email_open_rate')))}`);
const effPrev = prev(col('revenue')) / prev(col('marketing_spend'));
const effNow = last(col('revenue')) / last(col('marketing_spend'));
console.log(`  revenue/marketing_spend (efficiency ratio):  ${effPrev.toFixed(3)} -> ${effNow.toFixed(3)}   PoP growth ${pct((effNow - effPrev) / effPrev)}`);
console.log('    (revenue grew ' + pct((last(col('revenue')) - prev(col('revenue'))) / prev(col('revenue'))) + ', marketing_spend grew ' + pct((last(col('marketing_spend')) - prev(col('marketing_spend'))) / prev(col('marketing_spend'))) + ' -> the ratio moves by the difference)');
console.log('\nsub-scores as computed by the engine:');
for (const s of metrics.healthScores.Marketing.subScores) {
  console.log(`  ${s.key.padEnd(34)} growthRate ${String(s.growthRate).padStart(9)}  -> subScore ${s.subScore}  ${s.native ? '(native)' : '(borrowed)'}`);
}

console.log('\n=================== FUNDRAISING (score ' + metrics.healthScores.Fundraising.score + ') ===================');
console.log('grant_applications_submitted :', col('grant_applications_submitted').join(', '));
console.log('grant_applications_awarded   :', col('grant_applications_awarded').join(', '));
console.log('donors_total                 :', col('donors_total').join(', '));
console.log('\nlast two periods (Nov -> Dec):');
const arPrev = prev(col('grant_applications_awarded')) / prev(col('grant_applications_submitted'));
const arNow = last(col('grant_applications_awarded')) / last(col('grant_applications_submitted'));
console.log(`  award rate (awarded/submitted):  ${prev(col('grant_applications_awarded'))}/${prev(col('grant_applications_submitted'))} = ${arPrev.toFixed(3)}  ->  ${last(col('grant_applications_awarded'))}/${last(col('grant_applications_submitted'))} = ${arNow.toFixed(3)}   PoP growth ${pct((arNow - arPrev) / arPrev)}`);
console.log(`  donors_total:  ${prev(col('donors_total'))} -> ${last(col('donors_total'))}   PoP growth ${pct((last(col('donors_total')) - prev(col('donors_total'))) / prev(col('donors_total')))}`);
console.log('\nsub-scores as computed by the engine:');
for (const s of metrics.healthScores.Fundraising.subScores) {
  console.log(`  ${s.key.padEnd(30)} growthRate ${String(s.growthRate).padStart(9)}  -> subScore ${s.subScore}  ${s.native ? '(native)' : '(borrowed)'}`);
}
console.log(`\nFundraising = average(${metrics.healthScores.Fundraising.subScores.map((s) => s.subScore).join(', ')}) = ${metrics.healthScores.Fundraising.scoreExact}`);
console.log(`Marketing   = average(${metrics.healthScores.Marketing.subScores.map((s) => s.subScore).join(', ')}) = ${metrics.healthScores.Marketing.scoreExact}`);
