/**
 * Observability — structured request logging, redaction, and error capture
 * (Stage 5, Phase 29).
 *
 * Dependency-light by design, same as the migration runner: one-line JSON logs
 * to stdout/stderr with a hard redaction pass so a secret can never land in a
 * log line or an error report. Sentry is OPTIONAL: if SENTRY_DSN is set AND
 * `@sentry/node` is installed, errors are also forwarded there; otherwise this
 * degrades cleanly to console-only. Nothing here throws.
 */

// Keys whose value is always masked, regardless of nesting.
const SECRET_KEY_RE =
  /^(cookie|set-cookie|authorization|auth|password|password_hash|passwordhash|token|jwt|secret|database_url|databaseurl|postgres_url|connection_?string|.*_api_key|.*apikey|jwt_secret|cron_secret|resend_api_key)$/i;

// Value shapes that are a secret even under an innocent key.
const CONN_STRING_RE = /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SK_KEY_RE = /\b(sk|rk|re)_[A-Za-z0-9]{12,}\b/g;

const MASK = '[redacted]';

function redactString(s) {
  return String(s)
    .replace(CONN_STRING_RE, (m) => m.replace(/:\/\/[^@/]*@/, '://[redacted]@'))
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(JWT_RE, MASK)
    .replace(SK_KEY_RE, MASK);
}

/** Deep copy with secrets masked. Cycles and non-plain objects are handled. */
function redact(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message || ''), stack: redactString(value.stack || '') };
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? MASK : redact(v, seen);
  }
  return out;
}

/* -- optional Sentry ---------------------------------------------------- */

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

/* -- logging + capture ------------------------------------------------- */

function line(obj) {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* logging must never throw */
  }
}

/** One structured line per request. */
function requestLog({ method, path, status, ms, orgId }) {
  line({ level: 'info', kind: 'request', t: new Date().toISOString(), method, path, status, ms, orgId: orgId ?? null });
}

/**
 * Record an error. `context.code` is a stable slug an alert rule can target
 * (GEMINI_FAILURE, DEEPSEEK_FAILURE, DEEPSEEK_BALANCE_LOW, ROUTE_5XX, …).
 */
function captureError(err, context = {}) {
  const safe = redact({ ...context, message: err && err.message });
  try {
    process.stderr.write(`${JSON.stringify({ level: 'error', kind: 'error', t: new Date().toISOString(), ...safe })}\n`);
  } catch { /* ignore */ }
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        if (context.code) scope.setTag('code', context.code);
        scope.setExtras(redact(context));
        sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
    } catch { /* ignore */ }
  }
}

/** Record a noteworthy condition that isn't an exception (e.g. balance low). */
function captureMessage(code, context = {}) {
  const safe = redact(context);
  try {
    process.stderr.write(`${JSON.stringify({ level: 'warn', kind: 'signal', t: new Date().toISOString(), code, ...safe })}\n`);
  } catch { /* ignore */ }
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        scope.setTag('code', code);
        scope.setExtras(safe);
        sentry.captureMessage(code, 'warning');
      });
    } catch { /* ignore */ }
  }
}

module.exports = { redact, requestLog, captureError, captureMessage, sentryEnabled };
