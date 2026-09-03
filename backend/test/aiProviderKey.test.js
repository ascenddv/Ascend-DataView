/**
 * services/ai/provider.js (Phase 29 audit follow-up) — the Gemini API key must
 * travel in the x-goog-api-key HEADER, never the URL. A URL can end up in a
 * fetch error message, a log line, or an error-report context; a header cannot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../services/ai/provider');

const realFetch = global.fetch;
const realKey = process.env.GEMINI_API_KEY;
test.afterEach(() => {
  global.fetch = realFetch;
  if (realKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realKey;
});

test('complete() sends the key as x-goog-api-key and keeps it out of the URL', async () => {
  process.env.GEMINI_API_KEY = 'AIzaSyTESTKEY_do_not_log_this_value_1234567';
  let seen = null;
  global.fetch = async (url, init) => {
    seen = { url, headers: init.headers };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
    };
  };

  const text = await provider.complete('ping');
  assert.equal(text, 'hi');

  assert.ok(!/[?&]key=/.test(seen.url), `the key must not be a query param — url was ${seen.url}`);
  assert.ok(!seen.url.includes('AIzaSyTESTKEY'), 'the key value must not appear anywhere in the URL');
  assert.equal(seen.headers['x-goog-api-key'], 'AIzaSyTESTKEY_do_not_log_this_value_1234567');
  assert.equal(seen.headers['Content-Type'], 'application/json');
});

test('complete() throws a clean "not configured" error when the key is unset', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(provider.complete('ping'), /GEMINI_API_KEY is missing/);
});
