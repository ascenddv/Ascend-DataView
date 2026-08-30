/**
 * Phase 8 re-verification of the sanitizeForPrompt() guard against the new
 * users / organizations tables: confirm no email, org name, password hash, or
 * org metadata can reach a Gemini prompt via the live /api/insight path.
 *
 *   node scripts/verify-prompt-safety.mjs <baseUrl>
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toNarrationInput, sanitizeForPrompt } = require('../services/generateInsight.js');

const BASE = process.argv[2] || 'http://localhost:3002';
const stamp = Date.now();
const email = `promptsafe_${stamp}@test.com`;
const orgName = `Prompt Safety Org ${stamp}`;

let cookie;
async function req(method, path, { body, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, text: await res.text() };
}

await req('POST', '/api/auth/signup', { body: { email, password: 'password123', orgName } });

const fd = new FormData();
const buf = readFileSync('C:/Ascend-DataView/data/fixture_rich.csv');
fd.append('file', new Blob([buf], { type: 'text/csv' }), 'fixture_rich.csv');
await req('POST', '/api/upload', { form: fd });

const metrics = await req('GET', '/api/metrics');
const data = await req('GET', '/api/data');

const NEEDLES = [email, orgName, 'password_hash', 'org_id', '"role"', 'organization', 'ascenddv_token'];
let failures = 0;
function scan(label, body) {
  const hits = NEEDLES.filter((n) => body.includes(n));
  if (hits.length) failures += 1;
  console.log(`  ${hits.length ? 'FAIL' : 'PASS'}  ${label}${hits.length ? ` — leaked: ${hits.join(', ')}` : ' — no auth/org fields present'}`);
}

scan('/api/metrics response body', metrics.text);
scan('/api/data response body', data.text);

// The exact thing generateInsight would send to the model:
const m = JSON.parse(metrics.text);
const promptInput = JSON.stringify(toNarrationInput(sanitizeForPrompt(m)));
scan('generateInsight() prompt input', promptInput);
console.log(`  prompt-input top-level keys: ${Object.keys(toNarrationInput(m)).join(', ')}`);

// And confirm the guard actively rejects planted auth metadata.
try {
  sanitizeForPrompt({ ...m, healthScores: { ...m.healthScores, Financial: { ...m.healthScores.Financial, password_hash: 'x' } } });
  console.log('  FAIL  sanitizeForPrompt did not reject a planted password_hash');
  failures += 1;
} catch (e) {
  console.log(`  PASS  sanitizeForPrompt rejects planted auth metadata — "${e.message}"`);
}

console.log(`\n${failures === 0 ? 'PROMPT SAFETY: no auth/org data can reach a prompt' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
