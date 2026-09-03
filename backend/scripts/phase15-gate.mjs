/**
 * Phase 15 gate — AI insight: historical context.
 *   node scripts/phase15-gate.mjs <baseUrl> <repoRoot>
 *
 * The deterministic trend/self-baseline computation is verified over real merged
 * history via /api/metrics. The narration itself is exercised through the real
 * pipeline (real rows -> buildMetrics -> trends -> toNarrationInput -> prompt)
 * with only the LLM call faked — the same seam the unit tests use, and the only
 * option while the Gemini free tier is exhausted.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMetrics } = require('../services/buildMetrics');
const { generateInsight, toNarrationInput } = require('../services/generateInsight');
const { getStandardizedData } = require('../db');

const BASE = process.argv[2] || 'http://localhost:3001';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function client() {
  let cookie = null;
  return async (m, p, { body, form } = {}) => {
    const h = {};
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(BASE + p, { method: m, headers: h, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path.join(ROOT, 'data', f))], { type: 'text/csv' }), f);
  return fd;
};
async function signup(req, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await req('POST', '/api/auth/signup', {
    body: { email: `p15_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P15 ${label} ${s}`, acceptTos: true },
  });
  return r.json.org;
}

/* ---- real merged history -> deterministic trend context ---------------- */
console.log('\n== deterministic trend + self-baseline over real merged history ==');
const A = client();
const orgA = await signup(A, 'A');
await A('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
await A('POST', '/api/upload', { form: fileForm('fixture_rich_v2_delta.csv') });

const metricsRes = await A('GET', '/api/metrics');
const trends = metricsRes.json.trends || {};
check('metrics payload carries a per-dimension trends block', Object.keys(trends).length > 0,
  `dims: ${Object.keys(trends).join(', ')}`);

const fin = trends.Financial;
check('Financial trend has a code-computed direction', fin && ['increasing', 'flat', 'declining'].includes(fin.direction),
  fin && fin.direction);
check('Financial trend has a consistency read', fin && ['consistent', 'mixed', 'choppy'].includes(fin.consistency),
  fin && fin.consistency);
check('Financial trend compares latest to the org\'s OWN trailing average',
  fin && Number.isFinite(fin.latest) && Number.isFinite(fin.trailingAverage) && Number.isFinite(fin.deltaFromTrailingPct),
  fin && JSON.stringify({ latest: fin.latest, avg: fin.trailingAverage, deltaPct: fin.deltaFromTrailingPct }));
check('the growing rich fixture reads as increasing', fin && fin.direction === 'increasing');

const revKpi = (metricsRes.json.kpis || []).find((k) => k.key === 'revenue');
check('the revenue KPI carries its trailing-average self-comparison',
  revKpi && Number.isFinite(revKpi.trailingAverage) && Number.isFinite(revKpi.vsTrailingAveragePct),
  revKpi && JSON.stringify({ avg: revKpi.trailingAverage, pct: revKpi.vsTrailingAveragePct }));

/* ---- narration uses the trend context, every figure traceable --------- */
console.log('\n== the narrative references trend/consistency, grounded in the input ==');
const rowsA = await getStandardizedData(orgA.id);
const metricsA = buildMetrics(rowsA);

let promptSeen = '';
const groundedFake = async (prompt) => {
  promptSeen = prompt;
  const input = JSON.parse(prompt.slice(prompt.indexOf('INPUT:') + 6).trim());
  const t = input.trends.Financial;
  return {
    why: `Financial is ${t.direction} over the last ${t.periodsAnalyzed} periods (${t.consistency}); the latest ${t.metric} of ${t.latest} is ${t.deltaFromTrailingPct}% versus its own trailing average of ${t.trailingAverage}.`,
    recommendation: `Hold course on what is driving ${t.metric} and keep watching the trailing average.`,
  };
};
const insightA = await generateInsight(metricsA, { completeJson: groundedFake });
check('generateInsight returns ok with history present', insightA.status === 'ok');
check('the prompt hands the model the trends block + self-relative guidance',
  /"trends"/.test(promptSeen) && /"direction":/.test(promptSeen) && /its own recent average|self-relative|consecutive/i.test(promptSeen));
check('the narrative names the trend direction and consistency',
  /increasing|declining|flat/.test(insightA.why) && /(consistent|mixed|choppy)/.test(insightA.why),
  insightA.why);
const citedNums = (insightA.why.match(/-?\d+(?:\.\d+)?/g) || []);
check('every number cited in the narrative appears verbatim in the prompt input',
  citedNums.length > 0 && citedNums.every((num) => promptSeen.includes(num)),
  `cited: ${citedNums.join(', ')}`);

/* ---- degradation: too little history -> single-period narrative ------- */
console.log('\n== too few periods -> Stage 2 single-period style, no fabricated trend ==');
const B = client();
const orgB = await signup(B, 'B');
await B('POST', '/api/manual-entry', { body: { values: { period_date: '2025-01-31', revenue: '10000', expenses: '9000', cash_balance: '20000' } } });
await B('POST', '/api/manual-entry', { body: { values: { period_date: '2025-02-28', revenue: '10500', expenses: '9100', cash_balance: '20500' } } });

const rowsB = await getStandardizedData(orgB.id);
const metricsB = buildMetrics(rowsB);
check('a 2-period org produces no trend context', Object.keys(metricsB.trends || {}).length === 0);

let promptB = '';
await generateInsight(metricsB, {
  completeJson: async (p) => ((promptB = p), { why: 'Latest revenue was 10500 against expenses of 9100.', recommendation: 'Add more months to unlock trend analysis.' }),
});
check('the prompt tells the model there is no trend data and to narrate one period',
  /no "trends" data/i.test(promptB) && /single-period|latest period only/i.test(promptB));
check('the prompt contains no direction field to narrate', !/"direction":/.test(promptB));

/* ---- informational: does the real provider answer right now? ---------- */
const realInsight = await A('GET', '/api/insight');
console.log(`\n  (info) live GET /api/insight -> status "${realInsight.json && realInsight.json.status}"`);

console.log(`\n${fail === 0 ? 'ALL PHASE 15 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
