# AscendDV — Project Context

## What this is
Ascend Dataview (AscendDV) is an analytics platform for organizations with messy or incomplete data. It ingests raw data, calculates only the metrics the data can support, and renders only the dashboard cards backed by sufficient data. **Graceful degradation is the core product principle** — sparse data (or an unavailable AI provider) should produce a smaller, still-coherent experience, never an error, an empty chart, or a fabricated number.

## Project status
**Stages 1–4 are complete and verified**: single-tenant demo → multi-tenant Postgres product → trust/comprehension features → **AscendAI** (tool-grounded conversational chat). Deployed on Vercel (static frontend + the Express backend as one `/api` serverless function) with Supabase Postgres. Serverless durability (rate limiter + pending uploads moved to Postgres so shared state holds across function instances) is done and cross-instance-verified. This is the regression baseline nothing in Stage 5 may break.

**Stage 5 (in progress) is Production Hardening** — resolves a full production-readiness audit (security headers, migrations, rate limiting on every expensive endpoint, session revocation, transactional email + verification + password reset, team invites + owner/member roles, account/data deletion + export, AI kill-switches, observability, legal, CI, paid-infra cutover). See `SPEC_STAGE5.md`.

**Rule that carries over unchanged: complete a phase, pass its test gate, show the user, stop. Do not begin a new phase until the current one is confirmed. Commit the finished phase before proceeding — every phase report ends with that phase's commit hash.**

---

## AscendAI — provider and architecture

**Gemini** (`generateInsight()` / `mapColumns()`) runs on the **paid AI Studio tier** as of Stage 5 — commercial-licensed, inputs are not used to train Google's models. `GEMINI_API_KEY` must be a billing-enabled key. Vertex AI is the future option if a customer needs region pinning or a Google DPA.

**Provider: DeepSeek** for AscendAI, kept entirely separate from the Gemini key — different provider, different prepaid balance, different failure domain, so one running low or erroring never affects the other.
- Base URL: `https://api.deepseek.com` (OpenAI-compatible)
- Model: `deepseek-chat` (not `deepseek-reasoner` — the reasoning model doesn't support function/tool calling the way this feature needs)
- Env: `DEEPSEEK_API_KEY`
- Billing model: **prepaid balance, no auto-recharge.** This is a deliberate cost-safety choice, not an incidental detail — the spending ceiling is the balance itself, not a "spend limit" setting that has to be enforced correctly in real time. Never enable auto-recharge on this account; refilling the balance is a manual, deliberate action.

**Architecture: tool-based grounding, not context-dumping.** AscendAI does not receive the full metrics payload in every prompt. Instead, the model is given a small set of callable tools (`getHealthScore`, `getTrend`, `getKpi`, `getRiskDetails`, `getRevenueBySource`, etc.), each backed by a real function reading from the same deterministic `buildMetrics`/eligibility/confidence layer everything else in this app already uses. The model requests only the data it needs to answer a given question; the backend executes the real function and returns the real value. This extends the existing "AI narrates, never computes" rule: now it's *the AI decides what to look up, code computes it, the AI narrates the result* — the model still never invents or calculates a number itself.

**Scope boundary, enforced via system prompt:** AscendAI only answers questions about the requesting organization's own AscendDV data. It declines general-purpose requests (unrelated tasks, other organizations, anything outside its data) rather than attempting to answer them.

**Guard clause, unchanged in spirit from `generateInsight()`:** every tool result is passed through the same PII/identifier-rejection guard (`sanitizeForPrompt()` or an equivalent applied to tool outputs) before it can reach the model — no path for `email`, `password_hash`, `org_id`, `org_name`, `role`, or `token` to appear in a tool result or a prompt, exactly as already enforced for the insight layer.

**Every tool implementation takes `org_id` explicitly and is scoped by it**, following the same pattern as every other tenant-scoped data helper in this app — a tool call must never be able to return another organization's data.

---

## Conversation persistence and cost controls

- New table `chat_messages`, scoped by `org_id` and `user_id`: `role`, `content`, `created_at`.
- Each chat request loads a capped window of recent history (not the entire conversation, unbounded) to control token usage per call.
- A message-count rate limit applies per organization per day (a named constant in `config/thresholds.js`, same convention as every other threshold in this app) — protects the prepaid balance from being drained quickly by one org or a client bug, as defense in depth alongside the balance itself being the hard financial ceiling.
- A DeepSeek failure (balance exhausted, rate-limited, network error) must degrade the same way an exhausted Gemini quota already does elsewhere in this app: a clean, friendly "temporarily unavailable" response — never a raw 500 surfaced to the chat UI, and never breaking the rest of the dashboard.
- Basic token-usage logging per organization, for cost visibility — doesn't need to be sophisticated, just enough to see real usage before deciding whether the rate-limit constant needs adjusting.

---

## Everything else (unchanged from Stage 3)
Standardized schema, health scoring formula and recalibrated display bands, card eligibility thresholds, risk/opportunity rules, upload merge behavior, confidence tiers, mapping confirmation scope, `metricDefinitions.js`, PDF export, onboarding, auth conventions, and coding conventions all carry forward exactly as documented at the end of Stage 3. Stage 4 does not modify any of them — it adds a new, separately-scoped conversational feature alongside them.

## Reference
`SPEC_STAGE4.md` — AscendAI build plan (done). `SPEC_STAGE5.md` — Production Hardening, Phases 21–31 (in progress). Each phase has a test gate — do not begin a new phase until the current phase's gate has visibly passed and been shown to the user, and commit the completed phase (with its hash in the report) before moving on.