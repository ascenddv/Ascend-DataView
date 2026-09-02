# AscendDV — Stage 4 Build Spec: AscendAI

Read `CLAUDE.md` first for full project context and conventions before starting any phase. This file is the execution plan for adding AscendAI, a conversational chatbot that lets a user ask free-form questions about their own organization's data.

**Rule for every phase below, unchanged: complete the phase, run its test gate, show the output to the user, and stop. Commit the finished phase before proceeding to the next one — do not let uncommitted work accumulate across phases the way Stage 3 did.**

---

## Phase 18 — Provider integration and tool-based grounding core

**Goal:** a single working chat turn, no persistence or UI yet — prove the tool-calling loop against a real DeepSeek call before building anything on top of it.

Tasks:
- Add DeepSeek as a second, independent implementation alongside the existing Gemini implementation in the AI provider layer — a new function (e.g. `completeChatWithTools()`) following the same dependency-injection seam pattern already used for `generateInsight()`'s `completeJson`, so it's mockable in tests the same way.
- Add `DEEPSEEK_API_KEY` to `.env` / `.env.example`.
- Define the tool schema and implement each tool as a real function reading from the existing `buildMetrics`/eligibility/confidence layer, each taking `org_id` explicitly: `getHealthScore(dimension)`, `getTrend(metric)`, `getKpi(field)`, `getRiskDetails()`, `getRevenueBySource()`. Add more only if a clear need surfaces during testing — don't speculatively build tools nothing will call.
- Build the tool-execution loop: the model requests a tool call → the backend executes the real function → the result is passed through the sanitize guard → the result is returned to the model → repeat until the model produces a final text answer.
- Write the system prompt establishing the scope boundary (only this organization's AscendDV data; decline anything else) per `CLAUDE.md`.
- Build `POST /api/ascendai/chat` — single-turn only at this phase (no stored history), behind `requireAuth`, `org_id` taken from `req.auth` exactly like every other endpoint.
- Unit tests: each tool function returns correct data for a known fixture dataset; the sanitize guard rejects a planted identifier-like key in a tool result before it would reach the model; the tool-execution loop correctly handles a multi-tool-call turn (a question needing two lookups to answer).

**Test gate:**
- Against a real DeepSeek call (not a faked completion seam — this is the first "must be verified live" gate in this stage, and there's no free-tier quota excuse to defer it this time), ask a handful of real questions for a test org with real data: "What's my cash runway?", "Why did my Financial score change?", "What's the weather today?" (an explicit out-of-scope test).
- Confirm the in-scope questions trigger correct tool calls and produce answers citing real, traceable numbers.
- Confirm the out-of-scope question is declined per the system prompt rather than answered.
- Confirm a deliberate attempt to make a tool call resolve another organization's data fails — same isolation rigor as Phase 8.
- Show the full request/response trace (including tool calls made) for at least two of the test questions.

---

## Phase 19 — Conversation persistence and cost controls

**Goal:** multi-turn conversation memory, and the guardrails that keep this affordable and abuse-resistant.

Tasks:
- Create `chat_messages` (`org_id`, `user_id`, `role`, `content`, `created_at`), scoped and queried exactly like every other tenant table.
- Update `POST /api/ascendai/chat` to load a capped window of recent history (define the cap as a named constant in `config/thresholds.js`) as context, and persist both the user's message and the assistant's reply.
- Add `DELETE /api/ascendai/chat` to clear a conversation.
- Add a per-organization daily message rate limit (named constant, same convention as every other threshold), returning a clean, friendly limit-reached message rather than a generic error.
- Handle DeepSeek failures (balance exhausted, rate-limited, network error) with the same graceful-degradation pattern already used for Gemini elsewhere in this app — a clean "temporarily unavailable" response, never a raw 500, and never breaking anything else on the page.
- Add basic per-organization token-usage logging — simple is fine, the goal is visibility, not a billing system.

**Test gate:**
- Multi-turn conversation test: ask a question, then a follow-up that only makes sense with the prior turn's context ("what about last month?"), confirm it resolves correctly.
- Confirm history sent to the model is capped at the configured window, not unbounded.
- Confirm the rate limit fires after the configured threshold and returns the friendly message, not a raw error.
- Simulate a provider failure (e.g. a temporarily invalid key) and confirm the chat degrades gracefully without affecting the rest of the dashboard.
- Confirm one organization's conversation history is never visible to another, using the same live cross-org verification approach as Phase 8.

---

## Phase 20 — Frontend chat panel

**Goal:** the actual AscendAI user interface.

Tasks:
- Build a slide-out chat panel with an "Ask AscendAI" launcher, available from every dashboard view (not a separate page) — should feel contextual to whatever the user is currently looking at.
- Message list, input box, a loading state while waiting on a response, and a friendly rendering of the degraded "temporarily unavailable" state.
- A "clear conversation" control, wired to the Phase 19 endpoint.
- Match the existing design system (the same `CardChrome`-style visual language already used elsewhere) rather than a generic default-looking chat widget.

**Test gate:**
- Full walkthrough: open the panel, hold a multi-turn conversation, confirm real answers with real, traceable numbers throughout.
- Confirm "clear conversation" works.
- Force the degraded state (e.g. via a temporarily invalid key) and confirm it renders as a friendly message, not a broken panel or console errors.
- Zero console/page errors across the full walkthrough.

---

## After Phase 20

AscendAI is functionally complete: grounded in real computed data via tool calls, scoped to each organization, cost-protected by a prepaid balance plus application-level rate limiting, and gracefully degrading on failure. Anything beyond this — voice input, proactive/unprompted insights pushed from the chat, cross-organization benchmarking questions — is out of scope for Stage 4 and should not be started without a new spec section.
