/**
 * Provider-agnostic LLM interface.
 *
 * Every AI call in AscendDV goes through `complete()`. The rest of the codebase
 * never imports a vendor SDK or knows which model is behind this — swapping the
 * provider means editing only this file.
 *
 * Current provider: Google Gemini (Flash, free tier) via the REST API.
 */

// `gemini-flash-latest` is an alias Google keeps pointed at the current
// free-tier Flash model, so we don't chase version bumps. Override with
// GEMINI_MODEL in .env to pin a specific version.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Send a single prompt and get the model's text back.
 *
 * @param {string} prompt
 * @param {{ json?: boolean, temperature?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<string>} raw model text (JSON string if opts.json)
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function complete(prompt, opts = {}) {
  const { json = false, temperature = 0, timeoutMs = 20000, retries = 3 } = opts;

  if (!isConfigured()) {
    throw new Error('LLM provider not configured: GEMINI_API_KEY is missing');
  }

  // The API key goes in the x-goog-api-key HEADER, never the URL — a URL can end
  // up in a fetch error message, a log line, or an error-report context; a
  // header does not.
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastErr = new Error(`LLM request failed: ${err.message}`);
      continue; // network hiccup / timeout — retry
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 300);
      lastErr = new Error(`LLM HTTP ${res.status}: ${snippet}`);
      if (RETRYABLE_STATUS.has(res.status)) continue;
      throw lastErr; // 4xx (bad key, bad model, bad request) — no point retrying
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      lastErr = new Error('LLM returned an empty response');
      continue;
    }
    return text;
  }

  throw lastErr;
}

/**
 * Convenience wrapper: prompt in, parsed JSON out. Tolerates a model that wraps
 * its JSON in ```json fences despite being asked for raw JSON.
 */
async function completeJson(prompt, opts = {}) {
  const text = await complete(prompt, { ...opts, json: true });
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

module.exports = { complete, completeJson, isConfigured, GEMINI_MODEL };
