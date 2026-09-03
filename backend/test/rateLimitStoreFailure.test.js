/**
 * Rate-limit store failure (Phase 23 audit follow-up).
 *
 * If the PgRateStore can't reach Postgres, express-rate-limit's increment()
 * rejects. This asserts the concrete behavior rather than inferring it from the
 * code: the request is DENIED (routed to the error handler / 5xx) and the
 * protected handler never runs — it does NOT fail open and let the request
 * through unlimited.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');

function appWithStore(store) {
  const handlerRuns = { count: 0 };
  const app = express();
  app.get(
    '/probe',
    rateLimit({
      windowMs: 60_000,
      limit: 5,
      keyGenerator: () => 'k',
      validate: false,
      store,
    }),
    (_req, res) => {
      handlerRuns.count += 1;
      res.json({ ok: true, served: true });
    }
  );
  // Express default error handler would 500; make it explicit + quiet.
  app.use((_err, _req, res, _next) => res.status(500).json({ ok: false, error: 'store error' }));
  const server = app.listen(0);
  return { base: `http://127.0.0.1:${server.address().port}`, server, handlerRuns };
}

test('a store whose increment() rejects -> the request is denied (5xx), handler never runs', async () => {
  const store = {
    localKeys: false,
    init() {},
    async increment() { throw new Error('ECONNREFUSED 127.0.0.1:5432'); },
    async decrement() {},
    async resetKey() {},
    async resetAll() {},
  };
  const { base, server, handlerRuns } = appWithStore(store);
  try {
    const r1 = await fetch(`${base}/probe`);
    const r2 = await fetch(`${base}/probe`);
    assert.equal(r1.status, 500, 'first request denied, not served');
    assert.equal(r2.status, 500, 'still denied on a retry — not "fail open"');
    assert.equal(handlerRuns.count, 0, 'the protected handler must never execute when the limiter store is down');
  } finally {
    server.close();
  }
});

test('sanity: a working store lets requests through up to the limit', async () => {
  let n = 0;
  const store = {
    localKeys: false,
    init() {},
    async increment() { n += 1; return { totalHits: n, resetTime: new Date(Date.now() + 60_000) }; },
    async decrement() {},
    async resetKey() {},
    async resetAll() {},
  };
  const { base, server, handlerRuns } = appWithStore(store);
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await fetch(`${base}/probe`)).status, 200);
    assert.equal((await fetch(`${base}/probe`)).status, 429);
    assert.equal(handlerRuns.count, 5);
  } finally {
    server.close();
  }
});
