/**
 * A Postgres-backed store for express-rate-limit (fixed window).
 *
 * The default MemoryStore keeps counts in process memory — on a serverless
 * platform every function instance has its own, so a "10 per 15 minutes" limit
 * is really "10 per instance". This store puts the count in the shared
 * `rate_limits` table so it holds regardless of which instance serves a request.
 *
 * Implements the express-rate-limit v8 Store interface (increment / decrement /
 * resetKey / resetAll / init). `localKeys = false` tells the library the count
 * is shared, so its double-count check stays quiet.
 */

const { getDb } = require('../db');

class PgRateStore {
  constructor({ prefix = 'rl:' } = {}) {
    this.keyPrefix = prefix;
    this.windowMs = 60 * 1000;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  _k(key) {
    return this.keyPrefix + key;
  }

  async increment(key) {
    const { rows } = await getDb().query(
      `INSERT INTO rate_limits (key, hits, expires_at)
       VALUES ($1, 1, now() + ($2::double precision * interval '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.expires_at <= now() THEN 1
                     ELSE rate_limits.hits + 1 END,
         expires_at = CASE WHEN rate_limits.expires_at <= now()
                           THEN now() + ($2::double precision * interval '1 millisecond')
                           ELSE rate_limits.expires_at END
       RETURNING hits, expires_at`,
      [this._k(key), this.windowMs]
    );
    return { totalHits: rows[0].hits, resetTime: new Date(rows[0].expires_at) };
  }

  async decrement(key) {
    await getDb().query(
      `UPDATE rate_limits SET hits = GREATEST(hits - 1, 0)
       WHERE key = $1 AND expires_at > now()`,
      [this._k(key)]
    );
  }

  async resetKey(key) {
    await getDb().query('DELETE FROM rate_limits WHERE key = $1', [this._k(key)]);
  }

  async resetAll() {
    await getDb().query('DELETE FROM rate_limits WHERE key LIKE $1', [`${this.keyPrefix}%`]);
  }
}

module.exports = { PgRateStore };
