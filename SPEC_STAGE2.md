# AscendDV — Stage 2 Build Spec

Read `CLAUDE.md` first for full project context, schema, data model, and conventions before starting any phase. This file is the execution plan for taking the verified Stage 1 demo toward a legitimate multi-tenant product.

**Rule for every phase below, unchanged from Stage 1: complete the phase, run its test gate, show the output to the user, and stop. Do not proceed to the next phase until the user confirms the gate has passed.**

**Sequencing matters here more than it did in Stage 1.** Phase 7 (Postgres) and Phase 8 (multi-tenancy/auth) touch the data layer everything else depends on. Do not begin Phase 9, 10, or 11 until Phase 8 is fully confirmed — building new features on top of an unverified data-layer migration means any bug found later is much harder to isolate.

---

## Phase 7 — Postgres migration

**Goal:** swap the storage engine from SQLite to Postgres with zero behavior change. This is an infrastructure phase — no new features, no logic changes. If you find yourself changing what a function *returns*, stop and flag it; only *how it stores/retrieves* should change.

Tasks:
- Set up a local Postgres instance (Docker Compose is fine for local dev — include a `docker-compose.yml` if useful) with a `.env` entry for the connection string.
- Recreate `standardized_data` and `mapping_cache` table schemas in Postgres, matching the existing SQLite structure exactly.
- Replace the SQLite driver/queries in the backend with Postgres-compatible equivalents (`pg` package, or a lightweight query builder if that reduces risk — your call, but keep the query logic itself as close to a 1:1 translation as possible rather than an opportunity to refactor).
- Before deleting anything: export the current SQLite data (all 3 fixture datasets currently stored) and re-import it into Postgres, so the exact same records exist in the new database — this becomes your regression baseline.
- Re-run the full backend test suite (65 tests from Stage 1) against Postgres.

**Test gate:**
- All 65 existing backend tests pass unmodified (or with only trivial connection-setup changes, not logic changes) against Postgres.
- Re-run `/api/metrics` for `fixture_rich.csv`, `fixture_sparse.csv`, and `fixture_messy.csv` data now living in Postgres, and diff the output against the captured Stage 1 responses (health scores, eligible cards, risk/opportunity results). They must match exactly — any discrepancy is a bug introduced by the migration, not an acceptable side effect.
- Show the full diff (or explicit confirmation of no diff) for all 3 fixtures before proceeding.

---

## Phase 8 — Multi-tenancy and authentication

**Goal:** multiple organizations, each with a real user account and completely isolated data.

Tasks:
- Create `organizations` and `users` tables per the schema in `CLAUDE.md`.
- Add `org_id` (NOT NULL, FK) to `standardized_data` and `mapping_cache`.
- Create one `organizations` row for the existing Stage 1 data (e.g. "Demo Nonprofit") and backfill `org_id` on all existing rows so nothing is lost.
- Build `POST /api/auth/signup` and `POST /api/auth/login` — bcrypt for password hashing, JWT issued as an httpOnly cookie on success.
- Build auth middleware that verifies the JWT on every other `/api/*` route, extracts `org_id`, and attaches it to the request. Reject with 401 if missing/invalid.
- Update every service function that touches `standardized_data` or `mapping_cache` to accept and apply `org_id` explicitly — don't rely on middleware alone to enforce isolation; the query itself should be scoped.
- Update the frontend: login/signup pages, auth state, and ensure all API calls carry the auth cookie automatically.
- Re-verify the `sanitizeForPrompt()` guard clause from Stage 1 against the new tables — confirm no `email`, `password_hash`, or org metadata can reach a Gemini prompt under any code path.

**Test gate:**
- Create two separate test accounts/organizations ("Org A" and "Org B").
- Upload `fixture_rich.csv` to Org A and `fixture_sparse.csv` to Org B.
- Confirm `/api/metrics`, `/api/data`, and `/api/insight` for Org A's session only ever return Org A's data, and vice versa for Org B — test this by actually calling the endpoints with each account's session, not just by inspecting the code.
- Attempt a deliberate isolation-breaking test: use Org A's valid auth to try to access something that should require Org B's `org_id` (e.g. by tampering with a request parameter, if any endpoint accepts one) and confirm it fails rather than returning Org B's data.
- Confirm the existing 65+ backend tests still pass with `org_id` now required, updating test setup as needed to include a valid `org_id`/auth context — this should not require changing what the tests assert, only how they authenticate.
- Show both accounts' isolated dashboards side by side.

**Do not proceed to Phase 9 until this gate passes.** Everything after this phase is built assuming data isolation is airtight.

---

## Phase 9 — Additional health dimensions

**Goal:** extend from 3 health dimensions to the fuller set (People, Marketing, Fundraising, Impact, Strategic), using the identical eligibility and scoring pattern already proven in Stage 1 — this should feel like "more of the same shape," not new architecture.

Tasks:
- Add the new schema fields from `CLAUDE.md` to `schema.js`.
- Add the new dimension → sub-metric mappings to the health scoring config, using the exact same formula and native-signal eligibility rule as the original 3 dimensions.
- Confirm the eligibility engine and health score calculator have no hardcoded assumption of "3 dimensions" anywhere — they should already be data-driven from config, but verify this explicitly rather than assuming it.
- Create an updated rich fixture (or a new `fixture_rich_v2.csv`) that populates the new fields, to exercise the new dimensions.
- Add `HealthScoreCard` support for the new dimensions — this should require no new component code if the card was built generically in Stage 1; if it requires new code, that's worth flagging as a Stage 1 assumption that didn't fully generalize.

**Test gate:**
- Run `/api/metrics` against the updated rich fixture and confirm all 8 dimensions (3 original + 5 new) score correctly where data supports them.
- Run against the original Stage 1 `fixture_sparse.csv` (no new fields) and confirm the 5 new dimensions correctly show `Unavailable` — not a fabricated or zero score — exactly like Growth/Community did for sparse data in Stage 1.
- Show both outputs side by side.

---

## Phase 10 — Additional ingestion methods

**Goal:** accept Excel uploads and manual single-period entry, both routed through the existing normalization/validation/mapping pipeline — not a parallel implementation.

Tasks:
- Add `.xlsx` upload support via SheetJS (`xlsx` package). Parse the sheet into the same row-object shape the CSV pipeline already produces, then hand off to the existing `mapColumns`, normalization, and validation functions unchanged.
- Build a manual-entry form (frontend) and a corresponding endpoint (backend) that accepts a single period's field values directly. This bypasses file parsing but must still pass through the same normalization/validation functions used by file uploads — a manually-entered `$12,400` should be handled identically to one parsed from a CSV cell.
- Confirm both new paths respect `org_id` scoping from Phase 8.

**Test gate:**
- Convert `fixture_rich.csv` to an equivalent `.xlsx` file, upload it, and confirm the stored data and resulting `/api/metrics` output are identical to the CSV version.
- Manually enter one new period through the form UI, confirm it's stored correctly and reflected in `/api/metrics` on next fetch.
- Confirm existing CSV upload still works unchanged (regression check).

---

## Phase 11 — Additional dashboard views

**Goal:** per-dimension views (Financial, Growth, Community, People, Marketing, Fundraising, Impact, Strategic), not just Overview — using the same Card Eligibility Engine, filtered by category.

Tasks:
- Extend card metadata (if not already present) with a `category` tag per card.
- Build view navigation (tabs or sidebar) in the frontend.
- Each view requests the full eligible-card set from the existing `/api/metrics`/cards response and filters client-side by category — or, if cleaner, extend the API to accept a `view` query parameter and filter server-side. Either is acceptable; just don't duplicate eligibility logic between the API and the frontend.
- Overview remains the cross-dimension summary view already built; new views are additive.

**Test gate:**
- Navigate to each new view using the Phase 9 rich fixture data and confirm each shows only cards relevant to that category, respecting the same eligibility rules already established (a view must never show a card that Overview's eligibility check would have excluded).
- Confirm Overview is unchanged from before this phase.
- Full walkthrough across all views with no console errors, no empty states, no fabricated data — same bar as every Stage 1 gate.

---

## After Phase 11

At this point you have: a real multi-tenant product on Postgres with authentication, the fuller health-dimension model from the original product vision, multiple ingestion paths, and a proper per-dimension dashboard. Remaining known deferrals (PDF/DOCX parsing, org-type vocabulary switching beyond nonprofit, personalization/learned card ranking, trend/risk/confidence-weighted scoring) are open for a future stage — do not begin them without a new spec section, for the same reason Stage 1's scope discipline mattered: undocumented scope creep is how a phased plan quietly turns into the one-shot approach this structure exists to avoid.
