/**
 * Canonical field dictionary for AscendDV.
 *
 * This file is the single source of truth for field names. Ingestion, metric
 * calculation, card data and AI prompts all read names from here — nothing
 * else in the codebase may define or alias a schema field name.
 *
 * One row = one time period (monthly for this build).
 */

const CATEGORY = {
  FINANCIAL: 'Financial',
  GROWTH: 'Growth',
  COMMUNITY: 'Community',
  // Stage 2 (Phase 9) health dimensions
  PEOPLE: 'People',
  MARKETING: 'Marketing',
  FUNDRAISING: 'Fundraising',
  IMPACT: 'Impact',
  STRATEGIC: 'Strategic',
  NONE: null,
};

const TYPE = {
  DATE: 'date',
  NUMBER: 'number',
};

/**
 * Ordered field dictionary. Order here is the canonical column order used for
 * table creation and any tabular display.
 */
const FIELDS = [
  { name: 'period_date',         required: true,  category: CATEGORY.NONE,      type: TYPE.DATE,   notes: "Identifies the row's time period" },

  { name: 'revenue',             required: true,  category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Total revenue for the period' },
  { name: 'expenses',            required: true,  category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Total expenses for the period' },
  { name: 'cash_balance',        required: true,  category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'End-of-period cash on hand' },

  { name: 'revenue_donations',   required: false, category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Subset of revenue' },
  { name: 'revenue_grants',      required: false, category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Subset of revenue' },
  { name: 'revenue_events',      required: false, category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Subset of revenue' },
  { name: 'revenue_other',       required: false, category: CATEGORY.FINANCIAL, type: TYPE.NUMBER, notes: 'Subset of revenue' },

  { name: 'donors_total',        required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },
  { name: 'donors_new',          required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },
  { name: 'donors_returning',    required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },
  { name: 'volunteers_active',   required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },
  { name: 'volunteer_hours',     required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },
  { name: 'program_participants',required: false, category: CATEGORY.COMMUNITY, type: TYPE.NUMBER, notes: '' },

  { name: 'website_visitors',    required: false, category: CATEGORY.GROWTH,    type: TYPE.NUMBER, notes: '' },
  { name: 'social_followers',    required: false, category: CATEGORY.GROWTH,    type: TYPE.NUMBER, notes: '' },

  // --- Stage 2 (Phase 9): additional health dimensions ---
  { name: 'employees_total',              required: false, category: CATEGORY.PEOPLE,      type: TYPE.NUMBER, notes: '' },
  { name: 'employees_new',                required: false, category: CATEGORY.PEOPLE,      type: TYPE.NUMBER, notes: '' },
  { name: 'employees_departed',           required: false, category: CATEGORY.PEOPLE,      type: TYPE.NUMBER, notes: '' },
  { name: 'marketing_spend',              required: false, category: CATEGORY.MARKETING,   type: TYPE.NUMBER, notes: '' },
  { name: 'email_subscribers',            required: false, category: CATEGORY.MARKETING,   type: TYPE.NUMBER, notes: '' },
  { name: 'email_open_rate',              required: false, category: CATEGORY.MARKETING,   type: TYPE.NUMBER, notes: 'Fraction 0–1' },
  { name: 'grant_applications_submitted', required: false, category: CATEGORY.FUNDRAISING, type: TYPE.NUMBER, notes: '' },
  { name: 'grant_applications_awarded',   required: false, category: CATEGORY.FUNDRAISING, type: TYPE.NUMBER, notes: '' },
  { name: 'program_outcomes_achieved',   required: false, category: CATEGORY.IMPACT,      type: TYPE.NUMBER, notes: '' },
  { name: 'program_outcomes_targeted',   required: false, category: CATEGORY.IMPACT,      type: TYPE.NUMBER, notes: '' },
  { name: 'goals_total',                 required: false, category: CATEGORY.STRATEGIC,   type: TYPE.NUMBER, notes: '' },
  { name: 'goals_completed',             required: false, category: CATEGORY.STRATEGIC,   type: TYPE.NUMBER, notes: '' },
];

const FIELD_NAMES = FIELDS.map((f) => f.name);
const REQUIRED_FIELDS = FIELDS.filter((f) => f.required).map((f) => f.name);
const OPTIONAL_FIELDS = FIELDS.filter((f) => !f.required).map((f) => f.name);

/** Revenue subcategories, which should sum to approximately `revenue`. */
const REVENUE_SUBCATEGORY_FIELDS = FIELD_NAMES.filter(
  (name) => name.startsWith('revenue_')
);

const FIELDS_BY_NAME = Object.fromEntries(FIELDS.map((f) => [f.name, f]));

function fieldsByCategory(category) {
  return FIELDS.filter((f) => f.category === category).map((f) => f.name);
}

function isSchemaField(name) {
  return Object.prototype.hasOwnProperty.call(FIELDS_BY_NAME, name);
}

module.exports = {
  CATEGORY,
  TYPE,
  FIELDS,
  FIELD_NAMES,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  REVENUE_SUBCATEGORY_FIELDS,
  FIELDS_BY_NAME,
  fieldsByCategory,
  isSchemaField,
};
