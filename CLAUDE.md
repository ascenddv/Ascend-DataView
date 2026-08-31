# AscendDV — Project Context

## What this is
Ascend Dataview (AscendDV) is an analytics platform for organizations with messy or incomplete data. It ingests raw data, calculates only the metrics the data can support, and renders only the dashboard cards backed by sufficient data. **Graceful degradation is the core product principle** — sparse data should produce a smaller, still-coherent dashboard, never an error, an empty chart, or a fabricated number. This principle applies everywhere, including AI failures and now confidence display (a low-confidence value is shown honestly, never hidden or silently treated as equal to a clean one).

## Project status
**Stage 1 (single-tenant demo)** and **Stage 2 (multi-tenant product: Postgres, auth, 8 health dimensions, Excel/manual ingestion, per-dimension views)** are complete and verified. This is the regression baseline nothing in Stage 3 may break.

**Stage 3 (this spec) is in progress.** See `SPEC_STAGE3.md`. Stage 3's theme is *trust and comprehension* — the plumbing (data availability → metrics → cards) is correct and proven; Stage 3 is about making a real, non-technical user actually understand and believe what they're looking at, and about the app behaving correctly as a tool used repeatedly over time rather than a one-shot report generator.

**Rule that carries over unchanged: complete a phase, pass its test gate, show the user, stop. Do not begin a new phase until the current one is confirmed.**

---

## Health score display bands (Phase 12 — recalibrated, not the formula)
The scoring **formula** (`clamp(50 + growthRate*100, 0, 100)`, averaged per dimension) is locked and unchanged since Stage 1 — do not modify it in Stage 3.

What was wrong was the **band thresholds** used to label a score (Strong / Stable / Watch), which were arbitrary round numbers (60 / 80) that caused typical healthy growth (5–10% MoM) to read as "Watch." Phase 12 replaces these with thresholds derived from actually running the formula across a realistic range of growth rates (`scripts/analyze-health-bands.mjs`), not another guess.

**Derived thresholds (Phase 12 gate passed):**

| Band | Score | Corresponds to (avg PoP growth of a dimension's sub-metrics) |
|---|---|---|
| **Watch** | `< 48` | below −2% — a genuine, if mild, decline |
| **Stable** | `48 – 63` | −2% through +14% — holding steady to healthy growth |
| **Strong** | `≥ 64` | +14% or more, sustained — well above typical |

**Reasoning:** the formula is linear (`score ≈ 50 + growthRate_avg × 100`), so band cutoffs map directly to growth rates. The analysis showed:
- "typical healthy" nonprofit MoM growth is ~3–9% → scores 53–59, which the old cutoff wrongly bucketed as "Watch". Stable now starts at 48 so ordinary healthy orgs read Stable.
- flat (0% growth, score 50) is "not in trouble" → Stable, not Watch.
- a real decline of even a few percent (score < 48) → Watch. `fixture_sparse.csv` (Financial 47, a genuine ~−3% decline) correctly stays Watch.
- Strong is reserved for ~+14%+ sustained MoM growth across every sub-metric (score ≥ 64) — rare and genuinely outperforming; the old `≥ 80` cutoff required +30% and was effectively unreachable.

Implemented in `frontend/src/lib/healthBands.js` (labels, colours, the `healthBand()` mapping — consumed by `HealthScoreCard` and the Phase 17 tour). The two threshold **numbers** (Stable ≥ 48, Strong ≥ 64) live in one place, `shared/health-bands.json` at the repo root, read by both `healthBands.js` and the backend PDF report (`backend/services/pdfReport.js`) so the dashboard and the PDF snapshot can't drift; `backend/test/healthBandsSync.test.mjs` fails if either side re-hardcodes them. `calculateHealthScore` and the formula are untouched.

**Thin dimensions have no averaging cushion.** A dimension's score is the mean of its *available* sub-metrics (the mapping lives in `backend/services/subMetrics.js`). Dimensions built from only one or two sub-metrics — currently **Strategic** (one) and **People**, **Fundraising**, and **Impact** (two each) — can have their whole band flipped by a single noisy or declining input on its own. This is exactly what happened to People in the Phase 12 realistic-fixture check: one extra staff departure in the final month pushed its (inverted) turnover-rate sub-metric to a subScore of ~36, and with only one other, healthy sub-metric to average against, the dimension landed at 46 → Watch. That is a property of `mean(subScores)` at *any* threshold, **not** a banding defect — do not "fix" it by moving the bands or changing the formula for a specific case. It's recorded here so that a thin dimension looking surprising on real data is recognised, not re-diagnosed from scratch.

---

## Upload behavior: merge, not replace (Phase 13)
Uploads and manual entry both write to `standardized_data` scoped by `org_id` and keyed by `period_date`, using the same `UNIQUE (org_id, period_date)` upsert pattern established for manual entry in Stage 2 Phase 10. **A new upload merges into existing history — it does not replace the organization's dataset.**

- A period already present is **updated** (overwritten with the new file's values) — a re-upload is assumed to mean "here is a corrected file," not "start over."
- A period not previously present is **added**.
- The ingestion summary shown to the user must explicitly report both counts ("X periods added, Y periods updated") — silent overwriting without disclosure is not acceptable, consistent with the existing rule that row-level and validation issues are always surfaced, never silent.
- A full dataset wipe is only possible through a separate, explicitly destructive **reset action** (its own endpoint, its own confirmation step, scoped to the acting org only) — never as a side effect of a normal upload.

---

## Confidence indicators (Phase 14)
Every rendered card carries a confidence tier: **High / Medium / Low**, computed as the **weakest link** across every field and period feeding that card (not an average — one shaky input should not be diluted by several clean ones). Inputs to this determination:
- Column-mapping confidence score for the fields involved (below `LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE` → at most Medium)
- Whether a revenue-subcategory or other validation warning fired for any period the card draws from
- Source (`manual_entry` and exact-header-match uploads default High; unconfirmed/low-confidence LLM mappings default Low until confirmed)

Display: a 3-tier battery-style indicator plus a text label (never color alone — same accessibility rule established in Stage 1 Phase 6 for health bands). Hover/tap reveals a plain-language explanation of *why* that tier applies, not raw confidence numbers.

## Column-mapping confirmation (Phase 14)
When an upload produces any field in `fieldsNeedingConfirmation`, the user is shown an inline confirmation step **before the data is stored** — confirm or correct each flagged mapping. **Scope boundary, deliberate:** this only applies pre-storage, during the active upload flow. Retroactively correcting the mapping of already-stored historical data is explicitly out of scope for Stage 3 — it's a harder, data-migration-shaped problem (re-normalizing everything that was stored under a since-corrected mapping) and should not be folded into this feature. Revisit as its own dedicated future phase if it becomes necessary.

## Metric definitions (Phase 14)
A single static content file (`metricDefinitions.js` or equivalent) holds a plain-language definition and, where applicable, a hand-curated "typical range" note per metric/card. This is **general guidance, not a live benchmark** — there is no real benchmark dataset behind it, and the UI copy must not imply otherwise (e.g. "generally considered healthy" rather than "your peers average"). This file is the single source of truth for explanatory copy — the info/definition tooltips (Phase 14) and the onboarding tour (Phase 17) both read from it; never duplicate explanatory text in two places.

---

## AI insight: historical context (Phase 15)
`generateInsight()`'s narration input is extended (still via the same `toNarrationInput()` allow-list pattern) to include, per dimension: a trend direction/consistency signal over the trailing periods (increasing / flat / declining), and a comparison of the latest period against that organization's own trailing average — **both computed deterministically in code**, never by the model. The AI still only narrates; it does not calculate trend or the baseline itself.

This depends on Phase 13 (merge behavior) — meaningful trend/self-baseline framing requires real accumulated history across multiple uploads, not a single snapshot. With fewer periods than needed for a trend signal, the insight must degrade to the existing single-period narrative style rather than fabricating a trend from insufficient data — same graceful-degradation principle as everywhere else in this app.

---

## PDF export (Phase 16)
A point-in-time snapshot of the current Overview dashboard (health scores, KPIs, charts, risk/opportunity cards, insight text if available), clearly timestamped as a snapshot rather than live data. No new authentication surface — this operates on data the requesting user is already authorized to see, scoped by `org_id` exactly like every other endpoint. Shareable, unauthenticated read-only links are explicitly **not** part of this phase — that requires new access-control design (scoped tokens, expiration, revocation) with the same rigor Phase 8's auth got, and is deferred to a future stage.

---

## Onboarding (Phase 17)
`organizations` gains an `onboarding_completed` boolean. A first-time signup flows through a guided, single-focus wizard (Plaid-Link-style: one step at a time, clear progress) offering either a file upload or a downloadable CSV template to fill in. On first successful ingestion, an interactive tour walks through the now-populated real dashboard, explaining each section using the same `metricDefinitions.js` content from Phase 14 — not a separate copy of the same explanations. Once completed or skipped, `onboarding_completed` is set to true and the tour does not automatically reappear; it remains available on demand (a help icon / "replay tour" control) for returning users. Building this against real, already-correct dashboard behavior (accurate bands, merged history, confidence indicators) is why it's sequenced last in Stage 3 — touring someone through behavior that's still wrong teaches the wrong thing.

---

## Everything else (unchanged from Stage 2)
Standardized schema, health scoring formula, card eligibility thresholds, risk/opportunity rules, AI guard-clause rules, auth conventions, and coding conventions all carry forward exactly as documented at the end of Stage 2 — Stage 3 does not modify any of them except where explicitly noted above (display bands, upload merge behavior, and the AI narration allow-list extension).

## Reference
See `SPEC_STAGE3.md` for the phased build plan. Each phase has a test gate — do not begin a new phase until the current phase's gate has visibly passed and been shown to the user.