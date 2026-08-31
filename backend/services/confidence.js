/**
 * Per-card confidence tier (Phase 14a).
 *
 * A card's tier is the WEAKEST LINK across every field and period feeding it —
 * one shaky input is never diluted by several clean ones. The inputs to the
 * decision (CLAUDE.md "Confidence indicators"):
 *
 *   1. Column-mapping confidence for each feeding field. A field mapped below
 *      LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE caps the card at Medium once the user
 *      has confirmed that mapping, or at Low while it is still unconfirmed.
 *   2. A revenue-subcategory reconciliation warning in any feeding period caps
 *      the card at Medium.
 *   3. Source: manual entry and exact-header-match uploads are High.
 *
 * Pure: everything is derived from the stored rows' `source_meta` plus a
 * recomputed subcategory check. No I/O.
 */

const { REVENUE_SUBCATEGORY_FIELDS } = require('../config/schema');
const { LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE } = require('../config/thresholds');
const { subcategorySumWarning } = require('./ingest');

const TIERS = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const RANK = { High: 3, Medium: 2, Low: 1 };

const weakest = (a, b) => (RANK[a] <= RANK[b] ? a : b);

const FIELD_LABELS = {
  period_date: 'period',
  revenue: 'revenue',
  expenses: 'expenses',
  cash_balance: 'cash balance',
  revenue_donations: 'donations',
  revenue_grants: 'grants',
  revenue_events: 'events revenue',
  revenue_other: 'other revenue',
  donors_total: 'total donors',
  donors_new: 'new donors',
  donors_returning: 'returning donors',
  volunteers_active: 'active volunteers',
  program_participants: 'program participants',
  website_visitors: 'website visitors',
  social_followers: 'social followers',
};
const label = (f) => FIELD_LABELS[f] || f.replace(/_/g, ' ');

/**
 * Tier contributed by one field's mapping in one stored row.
 * @returns {{ tier: string, reason: string|null }}
 */
function fieldMappingTier(row, field) {
  const meta = row && row.source_meta;
  // Pre-Phase-14 rows carry no source_meta — nothing proves them shaky.
  if (!meta) return { tier: TIERS.HIGH, reason: null };
  if (meta.source === 'manual_entry') return { tier: TIERS.HIGH, reason: null };

  const conf = (meta.mapping_confidence || {})[field];
  // Field wasn't mapped from a header in this upload (exact match not recorded,
  // or value came from elsewhere) — treat as clean.
  if (conf === undefined || conf >= LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE) {
    return { tier: TIERS.HIGH, reason: null };
  }

  const confirmed = Boolean((meta.mapping_confirmed || {})[field]);
  return confirmed
    ? {
        tier: TIERS.MEDIUM,
        reason: `the “${label(field)}” column was matched by name similarity and you confirmed it`,
      }
    : {
        tier: TIERS.LOW,
        reason: `the “${label(field)}” column was matched with low confidence and has not been confirmed`,
      };
}

/**
 * @param {{ fields: string[], rows: Array<Object>, periods?: string[] }} input
 *   `rows` are the full sorted dataset; `periods` (optional) restricts the
 *   weakest-link scan to the period_dates that actually feed this card. Omit it
 *   for cards that draw on the whole history (a trend line).
 * @returns {{ tier: string, reasons: string[] }}
 */
function cardConfidence({ fields, rows, periods = null }) {
  const feeding = periods
    ? rows.filter((r) => periods.includes(r.period_date))
    : rows.slice();

  let tier = TIERS.HIGH;
  const reasons = new Set();

  for (const row of feeding) {
    for (const field of fields) {
      if (row[field] === null || row[field] === undefined) continue;
      const { tier: t, reason } = fieldMappingTier(row, field);
      if (RANK[t] < RANK[tier]) tier = t;
      if (reason) reasons.add(reason);
    }
  }

  const touchesRevenue = fields.some(
    (f) => f === 'revenue' || REVENUE_SUBCATEGORY_FIELDS.includes(f)
  );
  if (touchesRevenue) {
    for (const row of feeding) {
      if (subcategorySumWarning(row)) {
        tier = weakest(tier, TIERS.MEDIUM);
        reasons.add(
          `the revenue breakdown for ${row.period_date} did not add up to the revenue total`
        );
      }
    }
  }

  if (tier === TIERS.HIGH) {
    reasons.clear();
    reasons.add('every value here came from an exact column match or a figure you entered by hand');
  }

  return { tier, reasons: [...reasons] };
}

module.exports = { cardConfidence, fieldMappingTier, TIERS };
