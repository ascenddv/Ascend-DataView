/**
 * Phase 16 gate — point-in-time Overview PDF export.
 *   node scripts/phase16-gate.mjs <baseUrl> <repoRoot>
 *
 * Verifies each org's PDF reflects that org's real, current dashboard state,
 * that the endpoint is session-scoped with no tamperable parameter, and that
 * empty / sparse orgs still get an honest snapshot.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3001';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function client() {
  let cookie = null;
  return {
    cookie: () => cookie,
    async req(m, p, { body, form } = {}) {
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
      return r;
    },
  };
}
const json = async (r) => r.json().catch(() => null);
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path.join(ROOT, 'data', f))], { type: 'text/csv' }), f);
  return fd;
};
async function signup(c, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await c.req('POST', '/api/auth/signup', {
    body: { email: `p16_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P16 ${label} ${s}` },
  });
  return (await json(r)).org;
}

// pdfkit writes kerned <hex> runs; rebuild the readable text (compression off).
const pdfText = (buf) =>
  (Buffer.from(buf).toString('latin1').match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join('');

async function getPdf(c, url = '/api/report.pdf') {
  const r = await c.req('GET', url);
  const ab = await r.arrayBuffer();
  return { r, buf: Buffer.from(ab), text: pdfText(ab) };
}

/* ---- set up three orgs in different states --------------------------- */
const rich = client();
const orgRich = await signup(rich, 'rich');
await rich.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
await rich.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2_delta.csv') });

const sparse = client();
const orgSparse = await signup(sparse, 'sparse');
await sparse.req('POST', '/api/upload', { form: fileForm('fixture_sparse.csv') });

const empty = client();
await signup(empty, 'empty');

/* ---- the rich org's snapshot --------------------------------------- */
console.log('\n== rich org: the PDF reflects the full dashboard ==');
const R = await getPdf(rich);
check('200 with a PDF content type', R.r.status === 200 && (R.r.headers.get('content-type') || '').includes('application/pdf'),
  `${R.r.status} ${R.r.headers.get('content-type')}`);
check('served as a dated attachment', /attachment; filename="ascenddv-overview-\d{4}-\d{2}-\d{2}\.pdf"/.test(R.r.headers.get('content-disposition') || ''),
  R.r.headers.get('content-disposition'));
check('body is a real PDF', R.buf.toString('latin1').startsWith('%PDF-') && R.buf.length > 3000, `${R.buf.length} bytes`);
check('stamped as a point-in-time snapshot', /POINT-IN-TIME SNAPSHOT/.test(R.text) && /not a live view/.test(R.text));
check('carries this org\'s name', R.text.includes(orgRich.name));
check('shows health scores, KPIs, revenue-by-source and a risk',
  /Financial health/.test(R.text) && /Revenue/.test(R.text) && /REVENUE BY SOURCE/i.test(R.text) && /health/.test(R.text));
check('does NOT contain the sparse org\'s name', !R.text.includes(orgSparse.name));

/* ---- the sparse org's snapshot ----------------------------------- */
console.log('\n== sparse org: a smaller but honest snapshot ==');
const S = await getPdf(sparse);
check('200 PDF for the sparse org', S.r.status === 200 && S.buf.toString('latin1').startsWith('%PDF-'));
check('carries the sparse org\'s name, not the rich org\'s',
  S.text.includes(orgSparse.name) && !S.text.includes(orgRich.name));
check('has Financial health but no revenue-by-source (no subcategories in sparse)',
  /Financial health/.test(S.text) && !/REVENUE BY SOURCE/i.test(S.text));
check('does not fabricate dimensions sparse has no data for (People)', !/People health/.test(S.text));

/* ---- scoping: no tamperable parameter --------------------------- */
console.log('\n== the export is session-scoped and cannot be redirected ==');
const tamper1 = await getPdf(rich, `/api/report.pdf?org_id=${orgSparse.id}`);
const tamper2 = await getPdf(rich, `/api/report.pdf?orgId=${orgSparse.id}`);
check('?org_id=<other> is ignored — still the rich org\'s snapshot',
  tamper1.text.includes(orgRich.name) && !tamper1.text.includes(orgSparse.name));
check('?orgId=<other> is ignored too',
  tamper2.text.includes(orgRich.name) && !tamper2.text.includes(orgSparse.name));

const noAuth = await fetch(`${BASE}/api/report.pdf`);
check('no session -> 401, no PDF', noAuth.status === 401);

/* ---- empty org: still a valid, honest snapshot ---------------- */
console.log('\n== empty org: valid PDF that says there is nothing yet ==');
const E = await getPdf(empty);
check('200 PDF for an org with no data', E.r.status === 200 && E.buf.toString('latin1').startsWith('%PDF-'));
check('says there is no data to snapshot', /No data yet/.test(E.text) && /nothing to snapshot/.test(E.text));
check('shows no fabricated scores', !/Financial health/.test(E.text));

console.log(`\n${fail === 0 ? 'ALL PHASE 16 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
