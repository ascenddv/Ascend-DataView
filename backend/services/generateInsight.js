/**
 * generateInsight(metrics) — the narrative "why" + "what should we do" layer.
 *
 * Contract (CLAUDE.md "AI layer rules"):
 *   - Input is the ALREADY-COMPUTED metrics payload from buildMetrics() — health
 *     scores, KPIs, revenue-by-category, triggered risk/opportunity objects.
 *     Raw CSV rows must never reach this function.
 *   - The model narrates numbers; it never computes them. The prompt forbids
 *     inventing or recomputing figures.
 *   - PII is stripped at the boundary as a hard guard, not a comment — even
 *     though the canonical schema has no PII fields, so a future schema change
 *     cannot silently leak an identifier into a prompt.
 *   - This is a separate function with its own prompt, distinct from column
 *     mapping. Provider access goes through services/ai/provider.js so the
 *     underlying model can be swapped without touching this file.
 */

const provider = require('./ai/provider');

/* -------------------------------------------------------------------------- */
/* PII / raw-data guard                                                        */
/* -------------------------------------------------------------------------- */

// Keys that would indicate an individual identifier — or, since Phase 8, auth /
// tenant metadata — crept into the payload. The metrics payload never contains
// any of these; this guard makes sure a future change can't leak one.
const IDENTIFIER_KEYS = new Set([
  'name', 'first_name', 'last_name', 'full_name', 'donor_name', 'contact',
  'email', 'email_address', 'phone', 'phone_number', 'address', 'street',
  'ssn', 'dob', 'date_of_birth', 'ip', 'ip_address', 'user_id', 'userid',
  // Phase 8: auth + organization metadata must never reach a prompt.
  'password', 'password_hash', 'passwordhash', 'token', 'jwt', 'secret',
  'org_id', 'orgid', 'org_name', 'orgname', 'organization', 'organization_name', 'role',
]);

// Standardized-row shape — if we see this, someone passed raw ingested rows.
const RAW_ROW_MARKERS = ['period_date', 'source_meta'];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const PHONE_RE = /(?:\(\d{3}\)\s?|\b\d{3}[.\s-])\d{3}[.\s-]\d{4}\b/;

/**
 * Walks the payload. Throws on structural leakage (raw rows / identifier keys);
 * redacts free-text values that match a PII pattern and returns the cleaned copy.
 */
function sanitizeForPrompt(value, path = '$') {
  if (Array.isArray(value)) {
    return value.map((v, i) => sanitizeForPrompt(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);

    for (const key of keys) {
      if (IDENTIFIER_KEYS.has(key.toLowerCase())) {
        throw new Error(
          `generateInsight: refusing to build a prompt — identifier-like key "${key}" at ${path}`
        );
      }
    }
    if (RAW_ROW_MARKERS.some((m) => keys.includes(m))) {
      throw new Error(
        `generateInsight: refusing to build a prompt — payload at ${path} looks like a raw ingested row, not computed metrics`
      );
    }

    const out = {};
    for (const key of keys) out[key] = sanitizeForPrompt(value[key], `${path}.${key}`);
    return out;
  }
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value) || SSN_RE.test(value) || PHONE_RE.test(value)) {
      console.warn(`generateInsight: redacted a PII-matching string at ${path}`);
      return '[redacted]';
    }
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Prompt input projection                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Project the full metrics payload down to just the aggregates worth narrating.
 * Drops the per-period `series` arrays (not needed for prose, keep the prompt
 * small) and anything not on this explicit allow-list.
 */
function toNarrationInput(metrics) {
  const d = metrics.dataset || {};
  return {
    periods: {
      count: d.periodCount ?? 0,
      range: d.periods && d.periods.length ? `${d.periods[0]} to ${d.latestPeriod}` : null,
      granularity: d.granularity ?? null,
    },
    healthScores: Object.fromEntries(
      Object.entries(metrics.healthScores || {}).map(([dimension, h]) => [
        dimension,
        h.status === 'Available'
          ? {
              status: h.status,
              score: h.score,
              subScores: (h.subScores || []).map((s) => ({
                metric: s.key,
                growthRate: s.growthRate,
                subScore: s.subScore,
              })),
            }
          : { status: h.status, reason: h.reason || null },
      ])
    ),
    kpis: (metrics.kpis || []).map((k) => ({
      metric: k.label,
      latest: k.latest,
      change: k.change,
      growthRatePct: k.growthRate == null ? null : Number((k.growthRate * 100).toFixed(1)),
      trailingAverage: k.trailingAverage ?? null,
      vsTrailingAveragePct: k.vsTrailingAveragePct ?? null,
    })),
    // Phase 15: per-dimension trend + self-baseline, all computed in code. Empty
    // when there isn't enough history — the prompt then narrates the latest
    // period only.
    trends: Object.fromEntries(
      Object.entries(metrics.trends || {}).map(([dimension, t]) => [
        dimension,
        {
          metric: t.metric,
          direction: t.direction,
          consistency: t.consistency,
          consecutivePeriods: t.consecutivePeriods,
          periodsAnalyzed: t.periodsAnalyzed,
          latest: t.latest,
          trailingAverage: t.trailingAverage,
          deltaFromTrailingPct: t.deltaFromTrailingPct,
        },
      ])
    ),
    revenueByCategory: (metrics.revenueByCategory || []).map((c) => ({
      source: c.label,
      amount: c.value,
    })),
    risksOpportunities: (metrics.risksOpportunities || []).map((r) => ({
      type: r.type,
      title: r.title,
      detail: r.detail,
      metricValue: r.metricValue,
    })),
    cardEligibility: metrics.cards || {},
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                      */
/* -------------------------------------------------------------------------- */

function buildPrompt(narrationInput) {
  const hasHistory = Object.keys(narrationInput.trends || {}).length > 0;

  const historyGuidance = hasHistory
    ? `INPUT.trends holds, per dimension, a code-computed trend "direction" (increasing / flat / declining), a "consistency" read, a "consecutivePeriods" run count, and the latest value of that dimension's primary "metric" against the organization's OWN "trailingAverage" ("deltaFromTrailingPct"). INPUT.kpis may also carry "trailingAverage" / "vsTrailingAveragePct". You MAY use this for trend and self-relative framing — e.g. "the third consecutive month of decline" or "revenue is 12% above its own recent average" — but only with the exact direction, counts, and numbers given, and only where they are present.`
    : `INPUT has no "trends" data — there isn't enough history yet. Narrate the latest period only, as a single-period snapshot. Do NOT describe a trend, a streak, or a comparison to past periods.`;

  return `You are the analyst voice for AscendDV, a dashboard for small nonprofits with incomplete data.

You are given ONLY figures that deterministic code has already computed. Do NOT invent, recompute, estimate, or extrapolate any number. Every figure you mention must appear verbatim in INPUT. Do NOT compute a trend, average, or streak yourself — only cite the ones already in INPUT. If a health dimension is "Unavailable", say the data isn't there yet — never guess a score.

${historyGuidance}

Produce two short pieces:
- "why": ONE paragraph, 2-3 sentences. Anchor it to the single biggest signal in the data — the largest health-score movement, a triggered risk/opportunity, or a clear trend — and name the specific metric change behind it (cite the actual number).
- "recommendation": ONE short paragraph, 1-2 sentences, on the most useful next step, grounded in that same signal.

Plain, concrete, specific to these numbers. No preamble, no bullet lists, no restating the whole dashboard.

Respond with ONLY this JSON object and nothing else:
{ "why": "<paragraph>", "recommendation": "<paragraph>" }

INPUT:
${JSON.stringify(narrationInput, null, 2)}`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} metrics - a buildMetrics() payload
 * @returns {Promise<{
 *   status: 'ok' | 'unavailable',
 *   why: string|null,
 *   recommendation: string|null,
 *   model: string|null,
 *   generatedAt: string,
 *   reason?: string
 * }>}
 */
async function generateInsight(metrics, deps = {}) {
  const completeJson = deps.completeJson || provider.completeJson;
  const generatedAt = new Date().toISOString();

  if (!metrics || !metrics.dataset || !metrics.dataset.periodCount) {
    return {
      status: 'unavailable',
      why: null,
      recommendation: null,
      model: null,
      generatedAt,
      reason: 'No data has been uploaded yet.',
    };
  }

  // Guard clause — throws on raw rows / identifier keys, redacts PII-shaped text.
  const safeMetrics = sanitizeForPrompt(metrics);
  const narrationInput = toNarrationInput(safeMetrics);

  // The narrative is non-essential (the dashboard renders without it), so keep
  // the retry budget short — a throttled API should fail fast, not hang the card.
  const raw = await completeJson(buildPrompt(narrationInput), { retries: 1, timeoutMs: 25000 });
  const why = typeof raw?.why === 'string' ? raw.why.trim() : null;
  const recommendation =
    typeof raw?.recommendation === 'string' ? raw.recommendation.trim() : null;

  if (!why || !recommendation) {
    throw new Error('generateInsight: model response missing "why" or "recommendation"');
  }

  return {
    status: 'ok',
    why,
    recommendation,
    model: provider.GEMINI_MODEL,
    generatedAt,
  };
}

module.exports = { generateInsight, sanitizeForPrompt, toNarrationInput };
