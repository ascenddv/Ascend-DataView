# AscendDV — Project Context

## What this is
Ascend Dataview (AscendDV) is an analytics platform for organizations with messy or incomplete data. It ingests raw data, calculates only the metrics the data can support, and renders only the dashboard cards backed by sufficient data. **Graceful degradation is the core product principle** — sparse data should produce a smaller, still-coherent dashboard, never an error, an empty chart, or a fabricated number.

This build is a scoped demo, not the full product. Treat everything in "Explicitly deferred" as out of bounds unless the user says otherwise.

---

## Locked scope for this build
- **Org type:** one type only — small nonprofit
- **Ingestion:** CSV upload only (no PDF, DOCX, manual entry, or API integrations)
- **Health dimensions:** exactly 3 — Financial, Growth, Community
- **Card types:** exactly 5 — KPI, Trend, Bar Comparison, Health Score, Risk/Opportunity
- **Views:** exactly 1 — Overview (no per-dimension sub-views yet)
- **Scoring:** simple base score per dimension only (formula below). Trend/risk/confidence-weighted scoring is a deliberate v2 deferral — don't build it now, and don't build a half version of it either.

## Explicitly deferred (do not build these)
- PDF/DOCX parsing
- Org-type vocabulary switching
- Personalization / learned card ranking
- Full 9-dimension health scoring
- A Tier 0–5 data-availability ladder — this is redundant with the Card Eligibility Engine (Phase 3). Build eligibility checks per-card, not a separate tiering system.

---

## Tech stack
- **Frontend:** React + Tailwind CSS, Recharts for charts
- **Backend:** Node.js + Express
- **Storage:** SQLite
- **CSV parsing:** PapaParse
- **AI layer:** Google Gemini API (Flash model, free tier) via `GEMINI_API_KEY` in `.env`. Build the AI-calling code behind a provider-agnostic interface (e.g. a single `generateInsight(metrics)` function and a single `mapColumns(headers)` function) so the underlying provider could be swapped later without touching any calling code.

---

## Standardized schema (canonical field dictionary)
This is the single source of truth for field names. Use these exact names everywhere — ingestion, metric calculations, card data, AI prompts. Never invent an alternate name for the same concept; if a new field is genuinely needed, add it here first.

One row = one time period (monthly recommended).

| Field | Required | Category | Notes |
|---|---|---|---|
| `period_date` | Yes | — | Identifies the row's time period |
| `revenue` | Yes | Financial | Total revenue for the period |
| `expenses` | Yes | Financial | Total expenses for the period |
| `cash_balance` | Yes | Financial | End-of-period cash on hand |
| `revenue_donations` | No | Financial | Subset of `revenue` |
| `revenue_grants` | No | Financial | Subset of `revenue` |
| `revenue_events` | No | Financial | Subset of `revenue` |
| `revenue_other` | No | Financial | Subset of `revenue` |
| `donors_total` | No | Community | |
| `donors_new` | No | Community | |
| `donors_returning` | No | Community | |
| `volunteers_active` | No | Community | |
| `volunteer_hours` | No | Community | |
| `program_participants` | No | Community | |
| `website_visitors` | No | Growth | |
| `social_followers` | No | Growth | |

If `revenue_*` subcategories are present, they should sum to approximately `revenue` (allow rounding tolerance). A mismatch is a validation **warning**, not a hard failure.

---

## Health scoring formula (v1 — keep it exactly this simple)
For each of the 3 dimensions, compute a score from 0–100:

1. For each available sub-metric with ≥2 periods of history, compute period-over-period growth rate: `(current - previous) / previous`
2. Convert to a sub-score: `subScore = clamp(50 + (growthRate * 100), 0, 100)` — 0% growth = neutral 50; positive growth pushes the score up; negative pushes it down.
3. Dimension score = average of all available sub-scores for that dimension.
4. If **zero** sub-metrics are available for a dimension, that dimension's Health Score card is `Unavailable` — never show a default, zero, or guessed score.

**Dimension → sub-metric mapping:**
- **Financial:** revenue growth, expense growth (inverted — lower/negative expense growth is good), cash balance growth
- **Growth:** revenue growth, donor growth (`donors_total`), website visitor growth, social follower growth
- **Community:** donor retention rate (`donors_returning / donors_total` of prior period), volunteer growth (`volunteers_active`), program participant growth

---

## Card eligibility thresholds
Define these as named constants in one config file (e.g. `backend/config/thresholds.js`). Never hardcode these numbers inline elsewhere.

```
MIN_PERIODS_FOR_GROWTH_RATE = 2
MIN_PERIODS_FOR_TREND_CARD = 3
MIN_CATEGORIES_FOR_COMPARISON_CARD = 2
MIN_SUBMETRICS_FOR_HEALTH_SCORE = 1
LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE = 0.8
```

## Risk / Opportunity rules (deterministic — not LLM-judged)
- **Funding concentration risk:** any single `revenue_*` subcategory exceeds 50% of total `revenue` for the latest period
- **Cash runway risk:** `cash_balance` ÷ average monthly `expenses` (trailing 3 periods) < 3 months
- **Revenue decline risk:** revenue growth rate < -10% period-over-period
- **Donor retention opportunity:** donor retention rate improved by more than 10 percentage points vs. the previous period

These rules run in code. The AI layer describes the result in prose; it does not decide whether the risk/opportunity fired.

---

## AI layer rules
- The AI **never** computes numbers. It only narrates numbers that deterministic code already calculated.
- Strip any potential individual identifier before constructing a prompt (the schema above has no PII fields by design — enforce this at the function boundary anyway, as a safeguard against future schema changes).
- Column-mapping and narrative-insight are two separate functions with two separate prompts. Don't combine them.
- Cache column-mapping results by a hash of the uploaded CSV's header row — a re-upload with the same header shape should not re-trigger an LLM call.
- Column-mapping responses must include a confidence score per field. Anything below `LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE` gets flagged for manual confirmation rather than silently auto-mapped.

---

## Coding conventions
- Metric calculation functions must be pure (no side effects, no I/O) — e.g. `calculateGrowthRate(current, previous)`, `calculateHealthScore(dimension, metrics)`. This is a testability requirement, not a style preference.
- Row-level ingestion failures must never fail the whole upload — log the bad row and the reason, continue processing the remaining rows, and surface a summary of skipped rows to the user.
- A card with insufficient supporting data must not render at all — never render "N/A," a zero standing in for missing data, or an empty chart.

---

## Reference
See `SPEC.md` for the phased build plan. Each phase has a test gate — do not begin a new phase until the current phase's gate has visibly passed and been shown to the user.
