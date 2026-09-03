/**
 * Observability — structured request logging, redaction, and error capture
 * (Stage 5, Phase 29).
 *
 * Dependency-light by design, same as the migration runner: one-line JSON logs
 * to stdout/stderr with a hard redaction pass. Sentry is OPTIONAL: if
 * SENTRY_DSN is set AND `@sentry/node` is installed, errors are also forwarded
 * there; otherwise this degrades cleanly to console-only.
 *
 * Guarantees:
 *   - `redact()` never throws. Hostile / exotic input (throwing getters,
 *     Buffers, Maps, cyclic graphs) degrades to a safe placeholder.
 *   - `requestLog` / `captureError` / `captureMessage` never throw and never
 *     block; a serialization failure is swallowed.
 *   - Every value that leaves this module has been through `redact()`.
 *
 * `redact()` masks in two independent passes:
 *   1. by KEY NAME — a key that *contains* any secret-concept word
 *      (password / secret / token / credential / api-key / private-key / auth /
 *      cookie / session / jwt / dsn / a *_url connection var) has its value
 *      replaced wholesale, at any depth.
 *   2. by VALUE SHAPE — inside every surviving string: DB connection strings,
 *      `Authorization: Bearer …`, JWTs, Google `AIza…` keys, `sk-…` / `sk_live_…`
 *      / `re_…` provider keys, and `?token=` / `?key=` / `?secret=` /
 *      `?password=` query parameters.
 *
 * It is a safety net, not a substitute for not logging secrets in the first
 * place — but it is deliberately over-eager: over-masking a value like
 * `authenticated: [redacted]` in a log line is acceptable; leaking one is not.
 */

const MASK = '[redacted]';

/* -- pass 1: key-name matching ---------------------------------------------- */

const SECRET_KEY_RE = new RegExp(
  [
    'passwd', 'password', 'passphrase', 'pwd',
    'secret',
    'token',
    'credential',
    'api[_-]?key',
    'private[_-]?key',
    'auth', // authorization, x-auth-token, …
    'cookie',
    'session',
    'bearer',
    'jwt',
    'dsn', // sentry
    '(?:database|postgres|pg|mysql|mongo|redis)[_-]?url',
    'connection[_-]?string',
  ].join('|'),
  'i'
);

/* -- pass 2: value-shape matching ---------------------------------------------- */

const CONN_STRING_RE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"']+/gi;
// Any HTTP auth scheme with an inline credential (Bearer / Basic / Token / …).
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Digest|Token|APIKey)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const GOOGLE_KEY_RE = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const STRIPE_INFIX_RE = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/gi;
const HYPHEN_KEY_RE = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const UNDERSCORE_KEY_RE = /\b(?:sk|rk|re)_[A-Za-z0-9]{12,}\b/g;
// A query parameter whose NAME contains a secret concept word — mask the value.
// Deliberately broad: masking `?zipcode=` in a log is harmless; leaking a
// `?client_secret=` is not.
const QS_SECRET_RE =
  /([?&][^=&\s#]*(?:token|key|secret|passw(?:or)?d|credential|auth|signature)[^=&\s#]*=)[^&\s"'<>#]+/gi;

function redactString(input) {
  let s;
  try {
    s = String(input);
  } catch {
    return MASK;
  }
  return s
    .replace(CONN_STRING_RE, (m) => m.replace(/:\/\/[^@\s]*@/, '://[redacted]@'))
    .replace(QS_SECRET_RE, `$1${MASK}`)
    .replace(AUTH_SCHEME_RE, `$1 ${MASK}`)
    .replace(JWT_RE, MASK)
    .replace(GOOGLE_KEY_RE, MASK)
    .replace(STRIPE_INFIX_RE, MASK)
    .replace(HYPHEN_KEY_RE, MASK)
    .replace(UNDERSCORE_KEY_RE, MASK);
}

/**
 * Deep copy with secrets masked. NEVER throws — any failure to process a node
 * degrades that node to a placeholder and processing continues.
 */
function redact(value, seen = new WeakSet()) {
  try {
    if (value == null) return value;

    const t = typeof value;
    if (t === 'string') return redactString(value);
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'bigint') return `${value}`;
    if (t === 'function') return '[function]';
    if (t === 'symbol') return '[symbol]';
    if (t !== 'object') return redactString(value);

    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Buffer.isBuffer(value)) return '[buffer]';
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary]';
    if (value instanceof Date) {
      try { return value.toISOString(); } catch { return '[date]'; }
    }
    if (value instanceof RegExp) return String(value);
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message || ''),
        stack: redactString(value.stack || ''),
      };
    }
    if (value instanceof Set) {
      return [...value].map((v) => redact(v, seen));
    }
    if (value instanceof Map) {
      const out = {};
      for (const [k, v] of value.entries()) {
        const key = typeof k === 'string' ? k : safeKey(k);
        out[key] = SECRET_KEY_RE.test(key) ? MASK : redactSafe(v, seen);
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v) => redactSafe(v, seen));

    const out = {};
    let entries;
    try {
      entries = Object.entries(value);
    } catch {
      return '[unredactable]';
    }
    for (const [k, v] of entries) {
      out[k] = SECRET_KEY_RE.test(k) ? MASK : redactSafe(v, seen);
    }
    return out;
  } catch {
    return '[unredactable]';
  }
}

// Per-node guard: a single throwing getter must not abort the whole object.
function redactSafe(v, seen) {
  try {
    return redact(v, seen);
  } catch {
    return '[unserializable]';
  }
}
function safeKey(k) {
  try {
    return String(k);
  } catch {
    return '[key]';
  }
}

/* -- optional Sentry ------------------------------------------------------- */

let sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    sentry = require('@sentry/node');
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL ? 'production' : process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
      beforeSend: (event) => redact(event),
    });
  } catch {
    sentry = null; // SDK not installed — console-only is fine
  }
}
const sentryEnabled = () => Boolean(sentry);

/* -- logging + capture --------------------------------------------------- */

function writeLine(stream, obj) {
  try {
    stream.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* logging must never throw */
  }
}

/** One structured line per request. */
function requestLog({ method, path, status, ms, orgId }) {
  writeLine(process.stdout, {
    level: 'info',
    kind: 'request',
    t: new Date().toISOString(),
    method,
    path,
    status,
    ms,
    orgId: orgId ?? null,
  });
}

// Merge a redacted context into a base log object. If redaction of the context
// didn't yield a plain object (hostile input -> a placeholder string), it is
// attached under `context` rather than spread — so a caller can never inject or
// break keys, and this never throws.
function mergeContext(base, context) {
  let safe;
  try {
    safe = redact(context);
  } catch {
    safe = '[unredactable]';
  }
  if (safe && typeof safe === 'object' && !Array.isArray(safe)) {
    for (const [k, v] of Object.entries(safe)) if (!(k in base)) base[k] = v;
  } else if (safe !== undefined) {
    base.context = safe;
  }
  return base;
}

/**
 * Record an error. `context.code` is a stable slug an alert rule can target
 * (GEMINI_FAILURE, DEEPSEEK_FAILURE, DEEPSEEK_BALANCE_LOW, ROUTE_5XX, …). The
 * stderr line carries a REDACTED stack so console-only deployments keep their
 * debuggability.
 */
function captureError(err, context = {}) {
  const line = { level: 'error', kind: 'error', t: new Date().toISOString() };
  try {
    const e = redact({ message: err && err.message, stack: err && err.stack });
    if (e && typeof e === 'object') Object.assign(line, e);
  } catch {
    /* err had a hostile message/stack getter — skip it */
  }
  mergeContext(line, context);
  writeLine(process.stderr, line);
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        const code = context && typeof context === 'object' ? context.code : undefined;
        if (code) scope.setTag('code', code);
        scope.setExtras(mergeContext({}, context));
        sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
    } catch {
      /* ignore */
    }
  }
}

/** Record a noteworthy condition that isn't an exception (e.g. balance low). */
function captureMessage(code, context = {}) {
  const line = mergeContext({ level: 'warn', kind: 'signal', t: new Date().toISOString(), code }, context);
  writeLine(process.stderr, line);
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        scope.setTag('code', code);
        scope.setExtras(mergeContext({}, context));
        sentry.captureMessage(code, 'warning');
      });
    } catch {
      /* ignore */
    }
  }
}

module.exports = { redact, redactString, requestLog, captureError, captureMessage, sentryEnabled };
