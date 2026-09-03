/**
 * DeepSeek provider — the AscendAI chat backend (Stage 4).
 *
 * Deliberately a SEPARATE module from ./provider.js (Gemini). Different vendor,
 * different key (`DEEPSEEK_API_KEY`), different prepaid balance, different
 * failure domain: an exhausted or erroring DeepSeek balance must never affect
 * `generateInsight()` / `mapColumns()`, and vice versa. Nothing here imports or
 * mutates the Gemini path.
 *
 * `deepseek-chat` (OpenAI-compatible). `deepseek-reasoner` is intentionally NOT
 * used — it doesn't support function/tool calling the way AscendAI needs.
 *
 * Billing: prepaid, no auto-recharge. The balance itself is the spend ceiling.
 */

// Endpoint + model are env-driven so the provider can be repointed without a
// code change (ASCENDAI_MODEL is an alias kept next to the other ASCENDAI_* env
// names; DEEPSEEK_MODEL still works).
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL =
  process.env.ASCENDAI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/**
 * One raw chat/completions call with tool definitions. Returns the parsed
 * OpenAI-shaped response body ({ choices: [{ message, finish_reason }], usage }).
 * Throws on a non-retryable HTTP error or after exhausting retries — the caller
 * (services/ascendai/chat.js) turns that into a graceful "unavailable".
 *
 * @param {{
 *   messages: Array<object>,
 *   tools?: Array<object>,
 *   temperature?: number,
 *   timeoutMs?: number,
 *   retries?: number
 * }} args
 */
async function completeChatWithTools(args) {
  const {
    messages,
    tools,
    temperature = 0,
    timeoutMs = 45000,
    retries = 2,
  } = args || {};

  if (!isConfigured()) {
    throw new Error('AscendAI provider not configured: DEEPSEEK_API_KEY is missing');
  }

  const url = `${DEEPSEEK_BASE_URL}/chat/completions`;
  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    temperature,
    ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastErr = new Error(`DeepSeek request failed: ${err.message}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).slice(0, 300);
      lastErr = new Error(`DeepSeek HTTP ${res.status}: ${snippet}`);
      if (RETRYABLE_STATUS.has(res.status)) continue;
      throw lastErr;
    }

    return res.json();
  }

  throw lastErr;
}

module.exports = { completeChatWithTools, isConfigured, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL };
