# AscendDV — Build Spec

Read `CLAUDE.md` first for full project context, schema, and conventions before starting any phase. This file is the execution plan.

**Rule for every phase below: complete the phase, run its test gate, show the output to the user, and stop. Do not proceed to the next phase until the user confirms the gate has passed.**

---

## Phase 0 — Environment check

**Goal:** confirm the project can actually run before building anything.

Tasks:
- Confirm Node.js version (`node --version`, should be 18+)
- Confirm `.env` exists with a `GEMINI_API_KEY` value present (don't print the key itself)
- Confirm `.gitignore` excludes `node_modules/`, `.env`, `dist/`, `build/`

**Test gate:** report the Node version found and confirm `.env`/`.gitignore` are correctly in place. Stop here for confirmation before scaffolding.

---

## Phase 1 — Scaffold, schema, and fixtures

**Goal:** a runnable skeleton, the canonical schema as code, and test data to build against for the rest of the project.

Tasks:
- Create project structure:
  ```
  /backend
    /config       (thresholds.js, schema.js)
    /routes
    /services
    /db
  /frontend
    /src
      /components
      /cards
  /data           (fixture CSVs live here)
  ```
- Create `backend/config/schema.js` implementing the canonical field dictionary from `CLAUDE.md` exactly (field names, required/optional, category) — this file is the single source of truth; nothing else should redefine field names.
- Create `backend/config/thresholds.js` implementing the named constants from `CLAUDE.md` exactly.
- Set up a minimal Express server (`backend/index.js`) with a health-check route (`GET /api/health` returning `{ status: "ok" }`).
- Set up a minimal React app (`frontend`) with Tailwind configured, that can hit `/api/health` and display the result — just to prove the connection works end to end.
- Set up SQLite with a `standardized_data` table matching the schema fields, plus a `source_meta` column (JSON) for tracking original source/confidence per row.
- **Generate 3 fixture CSVs** in `/data`:

  **`fixture_rich.csv`** — 12 monthly rows, clean headers matching the schema field names directly, all fields populated with plausible values for a small nonprofit (e.g. revenue $15k–$40k/month, expenses tracking close to revenue, 3 revenue subcategories present, donor/volunteer/community fields populated, gradual realistic growth trend with minor noise).

  **`fixture_sparse.csv`** — 3 monthly rows, headers matching schema names, only `period_date`, `revenue`, `expenses`, `cash_balance` populated. No community or growth fields at all.

  **`fixture_messy.csv`** — 8 monthly rows, deliberately imperfect to exercise ingestion robustness:
  - Non-matching headers that require mapping (e.g. `"Rev ($)"` instead of `revenue`, `"Total Donors"` instead of `donors_total`, `"Cash on Hand"` instead of `cash_balance`)
  - Currency formatting: `$12,400`, parentheses for negatives: `($800)`
  - At least 2 rows with a missing required field
  - At least 1 duplicate `period_date` row
  - Inconsistent date formats across rows (e.g. `2025-01-31` mixed with `01/31/2025`)

**Test gate:** show the folder structure, confirm the Express health-check route responds, confirm the React app renders and successfully calls it, and display the first few rows of all 3 fixture CSVs. Stop here for confirmation.

---

## Phase 2 — Ingestion & validation

**Goal:** upload a CSV and get clean, standardized, validated data into SQLite — this is the phase most likely to have subtle bugs, so it gets the most scrutiny.

Tasks:
- Build `POST /api/upload` (multipart CSV upload), parsed with PapaParse.
- **Deterministic value normalization** (no LLM): strip `$` and commas from numbers, treat `(1,200)`-style parentheses as negative, parse percentage strings, handle blank/`N/A`/`0` distinctly (blank ≠ zero).
- **Deterministic date normalization**: support common formats, detect the row-to-row granularity (should be monthly for this build), and count total valid periods found.
- **LLM column mapping** (`services/mapColumns.js`, using Gemini): given the uploaded header row, return a mapping to canonical schema field names with a confidence score per field. Cache results by a hash of the header row (a simple SQLite table `mapping_cache(header_hash, mapping_json)` is fine). Fields below `LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE` should be marked as needing manual confirmation rather than silently auto-mapped — for this build, surface these as a simple list in the upload response rather than building a full manual-mapping UI.
- **Row-level validation**: a bad row (missing required field, unparseable date, etc.) is skipped and logged with a reason — it must never crash or block the rest of the upload. The upload response should include a summary: `{ rowsProcessed, rowsSkipped, skippedReasons: [...] }`.
- **Revenue subcategory check**: if `revenue_*` fields are present, validate they roughly sum to `revenue`; mismatch is a warning in the response, not a failure.
- Store validated rows in the `standardized_data` table, with `source_meta` recording that the source was a CSV upload and a basic confidence flag (`high` if column mapping confidence was above threshold for all mapped fields used in that row, `low` otherwise).

**Test gate:** upload all 3 fixtures through the endpoint and confirm:
- `fixture_rich.csv` → all 12 rows stored, no skipped rows, high confidence
- `fixture_sparse.csv` → all 3 rows stored correctly with only the 4 populated fields, rest left null (not zero)
- `fixture_messy.csv` → column mapping correctly resolves the renamed headers, currency/date formatting is normalized, the duplicate period is handled (keep one, flag the duplicate), the intentionally-bad rows are skipped and reported by reason — and the upload does not crash

Show the response payload for each of the 3 uploads. Stop here for confirmation before building the metric engine on top of this data.

---

## Phase 3 — Metric & health score engine

**Goal:** turn stored standardized data into the numbers the dashboard will show — entirely in deterministic code.

Tasks:
- Build pure calculation functions in `backend/services/metrics.js`:
  - `calculateGrowthRate(current, previous)`
  - `calculateChange(current, previous)`
  - `calculateAverage(values)`
  - `calculateRatio(a, b)`
- Build `calculateHealthScore(dimension, availableSubMetrics)` implementing the exact v1 formula from `CLAUDE.md` — average of clamped sub-scores, `Unavailable` if zero sub-metrics.
- Build the **Card Eligibility Engine** (`backend/services/eligibility.js`): given the stored data for an organization, determine for each of the 5 card types whether it is `Available`, `Limited`, or `Unavailable`, using the threshold constants from `backend/config/thresholds.js`. No hardcoded numbers inside this file — it should only reference the constants.
- Build the **Risk/Opportunity rule engine** (`backend/services/riskRules.js`) implementing the 4 deterministic rules from `CLAUDE.md` exactly. Each rule returns either nothing or a structured object (`{ type: 'risk'|'opportunity', title, detail, metricValue }`).
- Write unit tests for all pure functions above using representative values (include at least one edge case per function — e.g. `previous = 0` for growth rate).
- Build `GET /api/metrics` returning computed metrics, health scores, and eligible cards for the current dataset.

**Test gate:** run the unit tests and show they pass. Then run `/api/metrics` against data from `fixture_rich.csv` and `fixture_sparse.csv` (re-upload each if needed) and confirm:
- Rich data produces all 3 health scores and multiple eligible cards including Trend and Bar Comparison
- Sparse data produces only a Financial health score (Growth and Community should be `Unavailable`), no Trend cards (fewer than 3 periods), and no Bar Comparison card (no revenue subcategories)

Show both responses side by side. Stop here for confirmation before building the UI.

---

## Phase 4 — Card engine & dashboard UI

**Goal:** render only the eligible cards, adapting cleanly to whatever data is actually available.

Tasks:
- Build the 5 card components in `frontend/src/cards/`:
  - `KpiCard` — number + period-over-period change indicator
  - `TrendCard` — number + sparkline (Recharts)
  - `BarComparisonCard` — bar chart across categories (e.g. revenue by source)
  - `HealthScoreCard` — large score + qualitative label (e.g. 80+ Strong, 60–79 Stable, <60 Watch) — label thresholds are a display concern, keep them out of the scoring formula itself
  - `RiskOpportunityCard` — title + detail text, visually distinct styling for risk vs. opportunity
- Build a card registry that maps eligibility results from `/api/metrics` to the correct component with the correct data — the Overview page should not contain any hardcoded card list; it renders whatever the API says is eligible.
- Build the Overview dashboard page: a responsive grid, cards rendered in a sensible priority order (Health Scores first, then KPI/Trend, then Risk/Opportunity).
- Handle the sparse-data case explicitly: confirm the layout still looks intentional with fewer cards, not like something is missing or broken.

**Test gate:** show the running dashboard (screenshot or description of the rendered output) for both `fixture_rich.csv` and `fixture_sparse.csv`. Confirm the sparse version shows a smaller but clean set of cards, with no empty chart placeholders or "N/A" text anywhere. Stop here for confirmation before adding the AI layer.

---

## Phase 5 — AI insight layer

**Goal:** generate the "Why?" / "What should we do?" narrative from already-computed metrics — never from raw data.

Tasks:
- Build `services/generateInsight.js` (Gemini Flash call): input is the computed metrics/health scores/triggered risk-opportunity objects from Phase 3 — never raw CSV rows.
- Prompt should ask for a short, structured response: one short paragraph on "why" (tie the biggest health-score movement or risk/opportunity to the underlying metric change) and one short "what should we do" recommendation. Request JSON output to make rendering straightforward.
- Enforce the PII-stripping rule from `CLAUDE.md` at the function boundary even though the current schema has no PII fields — this should be a guard clause, not a comment.
- Build `GET /api/insight` that calls this service using the current dataset's computed metrics.
- Add an `InsightCard` component (full-width) rendering the "why" and "what should we do" text, placed prominently on the Overview dashboard.

**Test gate:** run `/api/insight` against both `fixture_rich.csv` and `fixture_sparse.csv` data. Confirm the generated text is coherent, references the actual computed numbers (not hallucinated ones), and reads sensibly for both a data-rich and data-sparse case. Show both outputs. Stop here for confirmation before final polish.

---

## Phase 6 — Polish & demo prep

**Goal:** a clean, reliable walkthrough — this phase is about robustness, not new features.

Tasks:
- Add loading states for upload and dashboard data fetch.
- Add a friendly error state for a completely unparseable upload (e.g. wrong file type).
- Visual pass: consistent spacing, card sizing, color use for health scores and risk/opportunity cards.
- Full run-through: upload `fixture_messy.csv` fresh, confirm the mapping/validation summary displays sensibly to the user (not just in an API response), confirm the resulting dashboard renders correctly.
- Re-confirm `fixture_rich.csv` and `fixture_sparse.csv` still work end to end after all changes.

**Test gate:** full walkthrough of all 3 fixtures from upload through dashboard through AI insight, with no crashes, no empty states, no console errors. This is the final gate — once this passes, the demo is ready.
