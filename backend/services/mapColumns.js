/**
 * Column mapping: uploaded CSV headers → canonical schema field names.
 *
 * Strategy:
 *   1. Deterministic exact match first (name equality after case/punctuation
 *      folding). These get confidence 1.0 and cost nothing.
 *   2. If any header is still unmapped, ask the LLM to map the *full* header row
 *      (it sees which ones are already certain) and take its per-field
 *      confidence scores.
 *   3. Cache the merged result by a hash of the header row so an identical
 *      re-upload never calls the LLM again.
 *
 * Public surface is a single function `mapColumns(headers)` — callers never see
 * the provider. The `deps` parameter exists only so tests can inject fakes.
 */

const crypto = require('crypto');

const { FIELDS, FIELD_NAMES, isSchemaField } = require('../config/schema');
const { LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE } = require('../config/thresholds');
const provider = require('./ai/provider');
const { getCachedMapping, putCachedMapping } = require('../db');

function fold(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FOLDED_FIELD_INDEX = new Map(FIELD_NAMES.map((name) => [fold(name), name]));

function hashHeaders(headers) {
  const norm = headers.map((h) => String(h).trim().toLowerCase()).join('');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function deterministicMatch(header) {
  return FOLDED_FIELD_INDEX.get(fold(header)) || null;
}

function buildLlmPrompt(headers, knownExact) {
  const dictionary = FIELDS.map(
    (f) =>
      `- ${f.name} (${f.category || 'general'}${f.required ? ', required' : ''})` +
      (f.notes ? ` — ${f.notes}` : '')
  ).join('\n');

  const alreadyMapped = Object.entries(knownExact)
    .map(([h, field]) => `  "${h}" -> ${field}`)
    .join('\n');

  return `You map messy CSV column headers from a small nonprofit's financial/community spreadsheet to a fixed canonical schema.

CANONICAL FIELDS (map ONLY to these exact names):
${dictionary}

RULES:
- Return one entry for every header in the INPUT list.
- "field" must be one of the canonical field names above, or null if no field is a clear semantic match.
- "confidence" is your certainty from 0 to 1 that the mapping is correct.
- Do not map two different headers to the same field unless the data is genuinely duplicated.
- A header like "Rev ($)" maps to revenue; "Cash on Hand" maps to cash_balance; "Total Donors" maps to donors_total.
- Headers that look like row labels, notes, or totals with no schema equivalent get field: null.
${alreadyMapped ? `\nAlready confirmed by exact match (keep these, still include them):\n${alreadyMapped}` : ''}

INPUT HEADERS: ${JSON.stringify(headers)}

Respond with ONLY a JSON array, no prose:
[{ "header": "<exact input header>", "field": "<canonical field or null>", "confidence": <0..1> }]`;
}

function normalizeLlmResult(raw, headers) {
  const byHeader = new Map();
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.mappings) ? raw.mappings : [];
  for (const item of arr) {
    if (!item || typeof item.header !== 'string') continue;
    byHeader.set(item.header.trim(), item);
  }

  const out = {};
  for (const header of headers) {
    const item = byHeader.get(String(header).trim());
    let field = item && typeof item.field === 'string' ? item.field : null;
    if (field && !isSchemaField(field)) field = null;
    let confidence = item && typeof item.confidence === 'number' ? item.confidence : 0;
    confidence = Math.max(0, Math.min(1, confidence));
    out[header] = { field, confidence, source: 'llm' };
  }
  return out;
}

/**
 * @param {string[]} headers - the CSV header row, in order
 * @param {{ orgId?: number, complete?, cacheGet?, cachePut? }} [deps] - `orgId`
 *   scopes the persistent mapping cache (required unless cacheGet/cachePut are
 *   injected); the rest are test seams.
 * @returns {Promise<{
 *   mapping: Record<string, {field: string|null, confidence: number, source: string}>,
 *   fieldsNeedingConfirmation: Array<{header: string, field: string, confidence: number}>,
 *   unmappedHeaders: string[],
 *   fromCache: boolean,
 *   llmUsed: boolean,
 *   llmError: string|null
 * }>}
 */
async function mapColumns(headers, deps = {}) {
  // The persistent cache is per-org: two orgs with identical header shapes must
  // never share a cache entry.
  const cacheGet =
    deps.cacheGet || ((hash) => getCachedMapping(deps.orgId, hash));
  const cachePut =
    deps.cachePut || ((hash, mapping) => putCachedMapping(deps.orgId, hash, mapping));
  const completeJson = deps.completeJson || provider.completeJson;

  const headerHash = hashHeaders(headers);

  const cached = await cacheGet(headerHash);
  if (cached) {
    return { ...summarize(cached), mapping: cached, fromCache: true, llmUsed: false, llmError: null };
  }

  // 1. Deterministic pass
  const mapping = {};
  const knownExact = {};
  const unresolved = [];
  for (const header of headers) {
    const exact = deterministicMatch(header);
    if (exact) {
      mapping[header] = { field: exact, confidence: 1, source: 'exact' };
      knownExact[header] = exact;
    } else {
      unresolved.push(header);
    }
  }

  // 2. LLM pass (only if something is still unresolved)
  let llmUsed = false;
  let llmError = null;
  if (unresolved.length > 0) {
    try {
      const raw = await completeJson(buildLlmPrompt(headers, knownExact));
      const llmMapping = normalizeLlmResult(raw, headers);
      llmUsed = true;
      for (const header of unresolved) {
        mapping[header] = llmMapping[header] || { field: null, confidence: 0, source: 'llm' };
      }
    } catch (err) {
      llmError = err.message;
      for (const header of unresolved) {
        mapping[header] = { field: null, confidence: 0, source: 'unresolved' };
      }
    }
  }

  // 3. Cache the merged result (even a partial one — a re-upload shouldn't retry
  //    a flaky call automatically; the header hash is the cache key regardless).
  if (!llmError) await cachePut(headerHash, mapping);

  return { ...summarize(mapping), mapping, fromCache: false, llmUsed, llmError };
}

function summarize(mapping) {
  const fieldsNeedingConfirmation = [];
  const unmappedHeaders = [];
  for (const [header, m] of Object.entries(mapping)) {
    if (!m.field) {
      unmappedHeaders.push(header);
    } else if (m.confidence < LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE) {
      fieldsNeedingConfirmation.push({ header, field: m.field, confidence: m.confidence });
    }
  }
  return { fieldsNeedingConfirmation, unmappedHeaders };
}

module.exports = {
  mapColumns,
  hashHeaders,
  deterministicMatch,
  summarizeMapping: summarize,
};
