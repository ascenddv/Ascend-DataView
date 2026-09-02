/**
 * Phase 19 gate — AscendAI conversation persistence + cost controls.
 * Real DeepSeek calls for the conversational parts; direct DB seeding for the
 * rate-limit boundary; a second backend process with a bad key for the
 * provider-failure simulation.
 *   node scripts/phase19-gate.mjs [baseUrl]
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ASCENDAI_HISTORY_WINDOW_MESSAGES,
  ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG,
} = require('../config/thresholds');
const db = require('../db');

const BASE = process.argv[2] || 'http://localhost:3001';
const ROOT = 'C:/Ascend-DataView';
const WINDOW = ASCENDAI_HISTORY_WINDOW_MESSAGES;

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function client(baseUrl = BASE) {
  let cookie = null;
  return {
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const r = await fetch(baseUrl + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, json: await r.json().catch(() => null) };
    },
  };
}
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(`${ROOT}/data/${f}`)], { type: 'text/csv' }), f);
  return fd;
};
async function signup(c, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await c.req('POST', '/api/auth/signup', {
    body: { email: `p19_${label}_${s}@t.co`, password: 'password123', orgName: `P19 ${label} ${s}` },
  });
  return r.json.org;
}
const ask = (c, message) => c.req('POST', '/api/ascendai/chat', { body: { message } });
const firstReqLen = (res) => ((res.json.trace.requests[0] || {}).messages || []).length;
const startOfUtcDayIso = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
const userIdForOrg = async (orgId) => {
  const { rows } = await db.getDb().query('SELECT id FROM users WHERE org_id = $1 ORDER BY id ASC LIMIT 1', [orgId]);
  return rows[0].id;
};
async function waitForHealth(baseUrl, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if ((await fetch(baseUrl + '/api/health')).ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`backend at ${baseUrl} did not become healthy`);
}

/* ==================================================================== */
console.log('\n== 1. multi-turn conversation, context carried across turns ==');
const A = client();
const orgA = await signup(A, 'A');
await A.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
const mA = (await A.req('GET', '/api/metrics')).json;
const cashLatest = mA.kpis.find((k) => k.key === 'cash_balance').latest;
const cashPrev = mA.kpis.find((k) => k.key === 'cash_balance').previous;

const t1 = await ask(A, 'What is my current cash balance?');
check('turn 1: real latest cash balance', t1.json.status === 'ok' && String(t1.json.reply).replace(/[,$]/g, '').includes(String(cashLatest)), `latest ${cashLatest}`);

const t2 = await ask(A, 'What about last month?');
check('turn 2 ("what about last month?") answered', t2.json.status === 'ok');
check('turn 2 cites the PREVIOUS period cash balance (needs turn-1 context)', String(t2.json.reply).replace(/[,$]/g, '').includes(String(cashPrev)), `previous ${cashPrev}`);
const t2roles = (t2.json.trace.requests[0].messages || []).map((m) => m.role);
check('turn 2 request carried the prior turn as history (>=2 user, has assistant)',
  t2roles.filter((r) => r === 'user').length >= 2 && t2roles.includes('assistant'), `roles: ${t2roles.join(',')}`);

/* ==================================================================== */
console.log('\n== 2. recent-history window is capped, not unbounded ==');
for (const q of [
  'And my revenue?', 'And expenses?', 'And total donors?', 'How is Financial health?',
  'Any risks or opportunities?', 'Revenue by source?', 'How has revenue trended?', 'How many periods of data do I have?',
]) {
  await ask(A, q);
}
const capTurn = await ask(A, 'Just to confirm — what is my latest revenue figure?');
const cap = 1 + WINDOW + 1; // system + window + new user message
check(`a turn never sends more than system + ${WINDOW} + 1 = ${cap} messages`,
  firstReqLen(capTurn) <= cap, `sent ${firstReqLen(capTurn)}`);
const storedA = (await A.req('GET', '/api/ascendai/chat')).json;
check('the whole conversation is persisted (GET is not windowed)', storedA.messages.length > WINDOW, `${storedA.messages.length} stored`);
check('the model saw only the window, not the whole transcript', firstReqLen(capTurn) < storedA.messages.length + 2);

/* ==================================================================== */
console.log('\n== 3. per-org daily message rate limit fires cleanly ==');
const userA = await userIdForOrg(orgA.id);
let used = await db.countAscendaiUsageSince(orgA.id, startOfUtcDayIso());
for (; used < ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG; used += 1) {
  await db.recordAscendaiUsage(orgA.id, userA, { status: 'ok', totalTokens: 0 });
}
const atCap = await db.countAscendaiUsageSince(orgA.id, startOfUtcDayIso());
check('org A is now at the daily cap', atCap === ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG, `${atCap}/${ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG}`);

const blocked = await ask(A, 'One more question, please?');
check('blocked turn is HTTP 200 + ok:true (not a raw error)', blocked.status === 200 && blocked.json.ok === true, `http ${blocked.status}`);
check('blocked turn returns status "rate_limited" with a friendly message',
  blocked.json.status === 'rate_limited' && /message limit/i.test(blocked.json.reply || ''), JSON.stringify(blocked.json.reply));
const msgCountAfter = (await A.req('GET', '/api/ascendai/chat')).json.messages.length;
check('a blocked turn consumes no usage slot and persists no message',
  (await db.countAscendaiUsageSince(orgA.id, startOfUtcDayIso())) === atCap && msgCountAfter === storedA.messages.length);

/* ==================================================================== */
console.log('\n== 4. provider failure -> clean "unavailable", dashboard unaffected ==');
const BAD_PORT = 3097;
const badProc = spawn(process.execPath, ['index.js'], {
  cwd: `${ROOT}/backend`,
  env: { ...process.env, PORT: String(BAD_PORT), DEEPSEEK_API_KEY: 'sk-deliberately-invalid-key-000' },
  stdio: 'ignore',
});
try {
  await waitForHealth(`http://localhost:${BAD_PORT}`);
  const B = client(`http://localhost:${BAD_PORT}`);
  await signup(B, 'badkey');
  await B.req('POST', '/api/upload', { form: fileForm('fixture_sparse.csv') });
  const degraded = await ask(B, 'How is my Financial health?');
  check('provider failure -> HTTP 200 (not 500)', degraded.status === 200);
  check('provider failure -> status "unavailable", reply null, friendly reason',
    degraded.json.status === 'unavailable' && degraded.json.reply === null && /temporarily unavailable/i.test(degraded.json.reason || ''),
    JSON.stringify(degraded.json.reason));
  const other = await B.req('GET', '/api/metrics');
  check('rest of the dashboard unaffected (/api/metrics still 200 with data)',
    other.status === 200 && other.json.dataset.periodCount === 3);
} finally {
  badProc.kill();
}

/* ==================================================================== */
console.log('\n== 5. cross-org conversation isolation ==');
const C = client();
const orgC = await signup(C, 'C');
await C.req('POST', '/api/upload', { form: fileForm('fixture_sparse.csv') });

check('org C sees an empty conversation (org A history not visible)',
  (await C.req('GET', '/api/ascendai/chat')).json.messages.length === 0);

const cTurn = await ask(C, 'What did I ask you earlier?');
check('org C first turn carries NO history (system + new message only)', firstReqLen(cTurn) === 2, `sent ${firstReqLen(cTurn)}`);
const cTrace = JSON.stringify(cTurn.json.trace);
check('org A cash figures never appear anywhere in org C\'s trace',
  !cTrace.includes(String(cashLatest)) && !cTrace.includes(String(cashPrev)));

const cBefore = (await C.req('GET', '/api/ascendai/chat')).json.messages.length;
const cDel = await C.req('DELETE', '/api/ascendai/chat');
check('org C DELETE clears only its own messages', cDel.json.ok === true && cDel.json.cleared === cBefore, `cleared ${cDel.json.cleared}, had ${cBefore}`);
check('org A conversation untouched by org C DELETE',
  (await A.req('GET', '/api/ascendai/chat')).json.messages.length === storedA.messages.length);

console.log(`\n${fail === 0 ? 'ALL PHASE 19 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
await db.closeDb();
process.exit(fail === 0 ? 0 : 1);
