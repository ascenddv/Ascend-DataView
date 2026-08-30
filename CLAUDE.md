# AscendDV — Project Context

## What this is
Ascend Dataview (AscendDV) is an analytics platform for organizations with messy or incomplete data. It ingests raw data, calculates only the metrics the data can support, and renders only the dashboard cards backed by sufficient data. **Graceful degradation is the core product principle** — sparse data should produce a smaller, still-coherent dashboard, never an error, an empty chart, or a fabricated number. This principle applies everywhere, including AI failures (a failed insight call should degrade to no insight card, not a broken page).

## Project status
**Stage 1 (single-tenant demo) is complete and verified.** SQLite-backed, CSV-only, 3 health dimensions, 5 card types, 1 Overview view, single nonprofit org, no auth. All phases passed their test gates — this is the working baseline every Stage 2 change must not regress.

**Stage 2 (this spec) is in progress.** See `SPEC_STAGE2.md` for the phased plan: Postgres migration, multi-tenancy + auth, expanded health dimensions, expanded ingestion methods, expanded dashboard views.

**Rule that carries over unchanged: complete a phase, pass its test gate, show the user, stop. Do not begin a new phase until the current one is confirmed.**

---

## Tech stack (Stage 2)
- **Frontend:** React + Tailwind CSS, Recharts for charts
- **Backend:** Node.js + Express
- **Storage:** **Postgres** (migrated from SQLite in Phase 7 — see `SPEC_STAGE2.md`). Local dev can use Docker Postgres or a local install; production likely Railway/Render-hosted Postgres.
- **Auth:** bcrypt for password hashing, JWT for session tokens. No third-party auth provider for this stage — keep it self-contained.
- **CSV parsing:** PapaParse. **Excel parsing (new):** SheetJS (`xlsx` package) — parsed rows are converted to the same row-object shape CSV parsing already produces, then flow through the existing normalization/mapping/validation pipeline unchanged. Do not build a parallel ingestion path for Excel.
- **AI layer:** Google Gemini API (Flash model) via `GEMINI_API_KEY`, behind the existing provider-agnostic `generateInsight()` / `mapColumns()` interface. Unchanged from Stage 1.
- **Hosting:** Frontend on Vercel. Backend on Railway or Render (needs a real filesystem/persistent connection — not deployed as Vercel serverless functions, since cold-start ephemeral filesystems don't suit a stateful DB connection pool as cleanly, and there's no reason to fight that constraint yet).

---

## Data model (Stage 2 — multi-tenant)

**New tables:**

| Table | Key columns |
|---|---|
| `organizations` | `id`, `name`, `org_type`, `created_at` |
| `users` | `id`, `org_id` (FK → organizations), `email`, `password_hash`, `role`, `created_at` |

**Existing tables gain an `org_id` column (FK → organizations, NOT NULL):**
- `standardized_data`
- `mapping_cache`

**Isolation rule, non-negotiable:** every query against `standardized_data` or `mapping_cache` must be scoped by `org_id` extracted from the authenticated request's JWT. There is no code path where one org's data is queryable using another org's credentials. This is a security requirement, not a convenience filter — treat a missing `org_id` scope on any query as a bug severe enough to block a phase gate.

**Migrating Stage 1 data:** on the Postgres migration, create one `organizations` row (e.g. "Demo Nonprofit") and assign all existing standardized data to it, so the 3 fixture datasets remain usable as regression references throughout Stage 2.

---

## Standardized schema (canonical field dictionary)
Single source of truth for field names — unchanged in spirit from Stage 1, extended in Phase 9 for new health dimensions. Never invent an alternate name for an existing concept; add new fields here first before referencing them anywhere else.

**Stage 1 fields (unchanged):**

| Field | Required | Category |
|---|---|---|
| `period_date` | Yes | — |
| `revenue` | Yes | Financial |
| `expenses` | Yes | Financial |
| `cash_balance` | Yes | Financial |
| `revenue_donations` | No | Financial |
| `revenue_grants` | No | Financial |
| `revenue_events` | No | Financial |
| `revenue_other` | No | Financial |
| `donors_total` | No | Community |
| `donors_new` | No | Community |
| `donors_returning` | No | Community |
| `volunteers_active` | No | Community |
| `volunteer_hours` | No | Community |
| `program_participants` | No | Community |
| `website_visitors` | No | Growth |
| `social_followers` | No | Growth |

**New fields for Phase 9 (additional health dimensions) — add to `schema.js` exactly as follows:**

| Field | Required | Category |
|---|---|---|
| `employees_total` | No | People |
| `employees_new` | No | People |
| `employees_departed` | No | People |
| `marketing_spend` | No | Marketing |
| `email_subscribers` | No | Marketing |
| `email_open_rate` | No | Marketing |
| `grant_applications_submitted` | No | Fundraising |
| `grant_applications_awarded` | No | Fundraising |
| `program_outcomes_achieved` | No | Impact |
| `program_outcomes_targeted` | No | Impact |
| `goals_total` | No | Strategic |
| `goals_completed` | No | Strategic |

---

## Health scoring formula (unchanged — extend, don't modify)
For each dimension, compute a score 0–100:
1. For each available sub-metric with ≥2 periods of history, compute growth rate: `(current - previous) / previous`
2. Sub-score: `clamp(50 + (growthRate * 100), 0, 100)`
3. Dimension score = average of available sub-scores.
4. Zero sub-metrics available → dimension is `Unavailable`. Never a fabricated score.

**Native-signal eligibility rule (established during Stage 1, carries forward):** a dimension is only eligible to score if at least one available sub-metric is a field from that dimension's *own* schema category. A "borrowed" sub-metric from another category (e.g. revenue growth feeding Growth) can contribute to the score once the dimension is otherwise eligible, but cannot single-handedly confer eligibility.

**Extended dimension → sub-metric mapping (Stage 2 additions):**
- **People:** employee growth (`employees_total`), turnover rate (`employees_departed / employees_total`) — **inverted**, like expense growth: a rising turnover rate lowers the People score (resolved in Phase 9)
- **Marketing:** email subscriber growth (`email_subscribers`), email open rate trend (`email_open_rate`), marketing spend efficiency (`revenue / marketing_spend` per period, then its PoP growth — a borrowed revenue signal, non-native to Marketing)
- **Fundraising:** grant award rate (`grant_applications_awarded / grant_applications_submitted`), donor growth (`donors_total`, borrowed from Community)
- **Impact:** outcome achievement rate (`program_outcomes_achieved / program_outcomes_targeted`), program participant growth (`program_participants`, borrowed from Community)
- **Strategic:** goal completion rate (`goals_completed / goals_total`)

Every rate sub-metric above (turnover, grant award, outcome achievement, goal completion, marketing spend efficiency, plus Stage 1's donor retention) is computed the same way: build the ratio series per period, then take its period-over-period growth rate and feed that through the standard `clamp(50 + growthRate*100)`. No new shape — the generalised helper lives in `services/subMetrics.js`.

---

## Card eligibility thresholds (unchanged from Stage 1)
```
MIN_PERIODS_FOR_GROWTH_RATE = 2
MIN_PERIODS_FOR_TREND_CARD = 3   (exactly 3 = Limited, not Available — established in Stage 1)
MIN_CATEGORIES_FOR_COMPARISON_CARD = 2
MIN_SUBMETRICS_FOR_HEALTH_SCORE = 1
LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE = 0.8
```
These apply identically to every new health dimension added in Phase 9 — do not create dimension-specific threshold overrides without a documented reason added here first.

## Risk / Opportunity rules (unchanged from Stage 1)
- **Funding concentration risk:** any single `revenue_*` subcategory > 50% of total `revenue`
- **Cash runway risk:** `cash_balance` ÷ average monthly `expenses` (trailing 3 periods) < 3 months
- **Revenue decline risk:** revenue growth rate < -10% period-over-period
- **Donor retention opportunity:** donor retention rate improved > 10 percentage points vs. previous period

Only add new deterministic rules here (documented) — never let the AI layer decide whether a risk/opportunity fired.

---

## AI layer rules (unchanged from Stage 1)
- The AI never computes numbers — only narrates numbers deterministic code already computed.
- `sanitizeForPrompt()` is a real guard clause: rejects identifier-like keys, rejects raw ingested rows, redacts email/phone/SSN patterns. This must be re-verified against the new `users`/`organizations` tables in Phase 8 — confirm no user email, password hash, or org metadata can ever reach a prompt.
- Column-mapping and narrative-insight remain two separate functions/prompts.
- Mapping cache lookups (Phase 7 onward) must be scoped by `org_id` — one org's column-mapping cache must not leak into another's, even though header shapes might coincidentally match (e.g. two orgs both using QuickBooks exports with identical headers should still be treated as separate cache entries, since letting them share silently removes the audit trail of which org's data justified auto-accepting a mapping).

---

## Auth conventions (new in Stage 2)
- Passwords hashed with bcrypt, never stored or logged in plaintext.
- JWT stored as an httpOnly cookie, not `localStorage` — reduces XSS token-theft risk.
- Every `/api/*` route except `/api/auth/signup` and `/api/auth/login` requires a valid JWT.
- Middleware extracts `org_id` from the verified JWT and attaches it to the request object; all downstream service functions receive `org_id` explicitly as a parameter rather than re-deriving it — makes the isolation boundary visible in every function signature, not just in middleware.

---

## Coding conventions (unchanged)
- Metric calculation functions remain pure (no side effects, no I/O).
- Row-level ingestion failures never fail the whole upload — log and continue, surface a summary to the user.
- A card with insufficient data never renders — no "N/A," no zero standing in for missing data, no empty chart.
- New ingestion methods (Excel, manual entry) must reuse the existing normalization/validation/mapping pipeline — do not fork a parallel implementation per input method.

---

## Reference
See `SPEC_STAGE2.md` for the phased build plan. Each phase has a test gate — do not begin a new phase until the current phase's gate has visibly passed and been shown to the user.