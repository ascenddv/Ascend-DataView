# AscendDV — Stage 3 Build Spec

Read `CLAUDE.md` first for full project context and conventions before starting any phase. This file is the execution plan for taking the verified Stage 2 multi-tenant product toward something that generates real, understandable impact for a non-technical user.

**Rule for every phase below, unchanged: complete the phase, run its test gate, show the output to the user, and stop. Do not proceed to the next phase until the user confirms the gate has passed.**

**Sequencing is deliberate here.** Phase 13 (upload merge) is foundational — Phase 15's historical AI narration depends on real accumulated history existing, which only happens once uploads merge instead of replace. Phase 17 (onboarding) is last on purpose: it teaches a new user how the dashboard behaves, so it should be built against dashboard behavior that's already correct.

---

## Phase 12 — Recalibrate health score display bands

**Goal:** fix healthy organizations defaulting to "Watch" — without touching the locked scoring formula.

Tasks:
- Write a small analysis script that runs the existing `calculateHealthScore` formula across a realistic range of period-over-period growth rates (e.g. -20% to +20%) and records the resulting scores. The goal is to see what a "typical healthy" org's score distribution actually looks like, rather than guessing new cutoffs the same way the original 60/80 split was guessed.
- Based on that distribution, choose new band thresholds for Strong / Stable / Watch. Document the reasoning (not just the final numbers) in `CLAUDE.md`'s "Health score display bands" section.
- This is a display-layer change only — implement it in whatever component/config currently maps a numeric score to a band label (e.g. `HealthScoreCard` or a shared band-mapping util). `calculateHealthScore` and the underlying formula must not change.

**Test gate:**
- Show the growth-rate-to-score distribution analysis that justified the new thresholds.
- Re-run `/api/metrics` (or just the frontend render) against `fixture_rich_v2.csv` and confirm the health dimensions now read Strong or Stable, not Watch.
- Confirm `fixture_sparse.csv` (which has a real, legitimate decline) still correctly reads Watch — the fix should correct the *false positive*, not blunt the bands into meaninglessness by making everything read Strong.
- Confirm all existing backend/frontend tests still pass — this phase should not touch any test that asserts a raw numeric score, only ones asserting a band label, if any exist.

---

## Phase 13 — Upload merge behavior + reset action

**Goal:** an upload merges into an organization's existing history instead of replacing it; a full wipe requires a separate, deliberate action.

Tasks:
- Change the CSV/XLSX upload ingestion path to upsert by `(org_id, period_date)` — reuse the existing `UNIQUE (org_id, period_date)` constraint and `upsertStandardizedRow` pattern already built for manual entry in Stage 2.
- Update the ingestion summary response and UI to explicitly report `periodsAdded` and `periodsUpdated` counts, distinct from the existing `rowsSkipped`/`skippedReasons` reporting.
- Build a new, separate destructive action — e.g. `DELETE /api/organizations/:id/data` or equivalent — that wipes only the acting org's `standardized_data`, gated behind its own explicit confirmation step (not a single click; require typing the org name or an equivalent deliberate second action). Scope it by `org_id` from the authenticated session exactly like every other data-touching endpoint — no org can reset another org's data.
- Add this reset control to the frontend in a clearly separate, lower-prominence location (e.g. a settings/"danger zone" area), not adjacent to the normal upload control.

**Test gate:**
- Upload `fixture_rich_v2.csv` (12 periods) to a test org.
- Upload a second file to the same org containing 3 overlapping `period_date` values (with deliberately changed figures) plus 2 new periods.
- Confirm the resulting dataset has 14 periods total, the 3 overlapping periods reflect the new file's updated values, and the ingestion summary correctly reports "2 periods added, 3 periods updated."
- Confirm `/api/metrics` reflects the merged 14-period history correctly (health scores, trends, etc. computed over the full merged set).
- Confirm the reset action requires its confirmation step, and once confirmed, wipes only the acting org's data — verify a second org's data is untouched.

---

## Phase 14 — Confidence indicators, mapping confirmation, and metric definitions

**Goal:** three related trust-and-comprehension features, batched because they're largely independent of each other but share the same "make the data honest and legible" purpose.

### 14a — Confidence indicators
- Backend: compute a per-card confidence tier (High/Medium/Low) as the *weakest link* across all fields/periods feeding that card — see the determination rules in `CLAUDE.md`.
- Frontend: a 3-tier, battery-style indicator on every card, paired with a text label (not color alone). Hover/tap shows a plain-language explanation of why that tier applies — no raw confidence numbers or jargon.

### 14b — Column-mapping confirmation
- When an upload produces any field in `fieldsNeedingConfirmation`, show an inline confirmation step before the data is stored: the user sees each flagged mapping ("we think 'Rev ($)' means Revenue") and can confirm or correct it.
- Explicitly out of scope, per `CLAUDE.md`: retroactively correcting mappings for data already in storage. Do not build this now.

### 14c — Metric definition tooltips
- Add an info affordance (e.g. an (i) icon) next to each card/metric.
- On click/hover, show the plain-language definition and, where applicable, the hand-curated "typical range" note from `metricDefinitions.js` — a new single-source-of-truth content file, not inline strings scattered across components.
- Copy must clearly read as general guidance, not a data-backed benchmark (no real benchmark dataset exists yet — don't imply one does).

**Test gate:**
- Upload `fixture_messy.csv`: confirm cards drawing from the LLM-mapped/warning-triggering fields show Medium or Low confidence with a sensible hover explanation, while cleanly-sourced fields show High.
- Upload a file with a deliberately ambiguous header: confirm the mapping confirmation step appears before storage, and confirm both confirming and correcting a mapping work, with the corrected mapping (not the original guess) being what's actually stored.
- Click through the info icon on a representative sample of different card types and confirm the correct definition/typical-range content displays for each, sourced from `metricDefinitions.js`.

---

## Phase 15 — AI insight: historical context

**Goal:** the narrative layer references trend and the organization's own recent normal, not just the latest single-period delta.

**Depends on Phase 13** — this phase needs real multi-upload accumulated history to test meaningfully.

Tasks:
- Extend the deterministic pre-computation feeding `generateInsight()`: for each dimension, compute a trend direction/consistency signal over the trailing periods (increasing / flat / declining), and compute the latest period's key metrics against that organization's own trailing average.
- Extend `toNarrationInput()`'s allow-list to include these new fields — same guard-clause pattern as Stage 2, re-verify `sanitizeForPrompt()` still rejects anything it should with the expanded input shape.
- Update the prompt so the model can reference trend/consistency and self-relative framing when available (e.g. "this is the third consecutive month of decline" style framing), while still only citing figures present in its input.
- Explicitly handle insufficient history: if there aren't enough periods for a meaningful trend signal, the insight must degrade to the existing single-period narrative style rather than fabricating a trend from too little data.

**Test gate:**
- Build up multi-period history for a test org (via the merge behavior from Phase 13, or sequential manual entries).
- Run `/api/insight` and confirm the generated narrative accurately references trend/consistency and self-relative framing, with every cited figure traceable to the actual computed input.
- Confirm the guard-clause tests still pass against the expanded prompt-input shape.
- Confirm an org with too few periods for a trend signal gets the existing Stage 2-style single-period narrative, not a fabricated trend.

---

## Phase 16 — PDF export

**Goal:** a downloadable, timestamped, point-in-time snapshot of the Overview dashboard.

Tasks:
- Generate a PDF capturing the current Overview state for the authenticated org: health scores, KPIs, trend/comparison charts, risk/opportunity cards, and insight text if available.
- Clearly label it as a snapshot as of a specific date/time, not live data.
- No new auth surface — this operates on already-authorized data for the requesting session, scoped by `org_id` exactly like every other endpoint.

**Test gate:**
- Generate a PDF for a rich test org and a sparse test org; confirm each accurately reflects that org's actual current dashboard state (not another org's, not stale/cached data from a different org).
- Confirm the export endpoint is scoped by the authenticated session's `org_id` and cannot be manipulated (e.g. via a parameter) into producing another org's snapshot.

---

## Phase 17 — Onboarding wizard and interactive tour

**Goal:** a guided first-time experience — signup through first upload through a tour of the real, now-populated dashboard — that fades into on-demand help after first use.

Tasks:
- Add `onboarding_completed` (boolean, default false) to `organizations`.
- Build a guided post-signup wizard: single-focus steps with clear progress, offering either a file upload or a downloadable CSV template matching the schema (via the existing `GET /api/schema`).
- On first successful ingestion, automatically transition into an interactive tour of the dashboard populated with the organization's own real data — sequentially highlighting sections (health scores, KPIs, trend, risk/opportunity, per-dimension views) with explanatory copy sourced from `metricDefinitions.js` (Phase 14) — do not write a second, separate set of explanatory text.
- On tour completion or skip, set `onboarding_completed = true`. Subsequent logins go straight to the normal dashboard.
- Add an on-demand entry point (help icon or "replay tour" control) so a returning user can revisit the tour voluntarily.

**Test gate:**
- Full walkthrough as a fresh signup: confirm the wizard appears, confirm both the upload and template-download paths work, confirm the interactive tour triggers automatically on first successful ingestion and references the organization's actual real data (not placeholder/sample content).
- Confirm a second login for the same org does not automatically show the wizard or tour again.
- Confirm the on-demand replay control works correctly when triggered manually.

---

## After Phase 17

At this point the app should genuinely support its stated purpose: an organization can onboard itself, understand what it's looking at without external help, trust the confidence of what it's seeing, track its health over real accumulated time rather than one-off snapshots, and export something to share. Remaining known items — the pre-launch security/licensing punch list from Stage 2 (SheetJS advisory, Gemini commercial licensing, production secrets/HTTPS, email verification), shareable unauthenticated links, retroactive mapping correction, and true benchmark data — remain deliberately deferred and should not be started without a new spec section.
