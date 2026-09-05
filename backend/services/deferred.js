/**
 * Run a task in the background, after the HTTP response has already been sent.
 *
 * Why this exists: on Vercel, a serverless function can be frozen (and later
 * killed) the instant its response is flushed. Any promise still pending at
 * that point — e.g. a "fire-and-forget" email send — is dropped. Vercel exposes
 * a per-request `waitUntil(promise)` that keeps the invocation alive until the
 * promise settles. The `@vercel/functions` package is just a thin wrapper over
 * the request-context global below; this project can't add that dependency, so
 * we read the same context directly (the Symbol key `@vercel/functions` itself
 * uses).
 *
 * Off Vercel (local dev, tests, any other host) nothing freezes the process
 * once the response is sent, so the task simply runs detached — byte-for-byte
 * the previous fire-and-forget behaviour.
 */

function vercelWaitUntil() {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    if (ctx && typeof ctx.waitUntil === 'function') return ctx.waitUntil.bind(ctx);
  } catch {
    /* no request context available — fall through */
  }
  return null;
}

/**
 * @param {() => (Promise<unknown> | unknown)} task
 * @param {string} [label] used only in the failure log line
 */
function runAfterResponse(task, label = 'background task') {
  const promise = Promise.resolve()
    .then(task)
    .catch((err) => {
      console.error(`${label} failed: ${(err && err.message) || err}`);
    });

  const waitUntil = vercelWaitUntil();
  if (waitUntil) waitUntil(promise);
  // else: nothing to do — the promise runs to completion on its own.
}

module.exports = { runAfterResponse };
