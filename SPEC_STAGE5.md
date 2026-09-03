# AscendDV — Stage 5: Production Hardening

## Context

AscendDV (Stages 1–4 complete: multi-tenant analytics + AscendAI chat, deployed on
Vercel + Supabase) is approaching commercial launch. A full production-readiness
audit found blockers across security, legal, data lifecycle, reliability and ops.
This stage resolves every finding and adds the functionality a paid product needs
before real customers and real data.

**Decisions taken:**
- **AI providers:** keep Gemini + DeepSeek. Gemini runs on the **paid AI Studio tier**
  (commercial-licensed, not used for training). DeepSeek stays, with disclosure + a
  per-org toggle. Add kill-switches for both.
- **Multi-user:** build **user invites + roles (owner / member)** now.
- **Email:** **Resend**, behind a `services/email.js` abstraction with a dev no-op logger.
- **Legal:** scaffold `/legal` pages + signup consent + sub-processor list, **and** draft
  the ToS / Privacy copy (marked `DRAFT — needs legal review`).

**Assumptions:**
- **Migrations:** numbered `.sql` files + a tiny custom runner (`backend/db/migrate.js`),
  no new dependency. The current `initDb()` DDL becomes `001_init.sql`; request-time DDL
  is retired.
- **Unverified users:** may log in and view the dashboard, but **upload, AscendAI, invites,
  and export are blocked** until email is verified (resend-verification always allowed).
- **Roles:** `owner` (created at signup; invites, member management, org deletion, data
  reset, data export, billing later) and `member` (dashboard, upload, AscendAI, own chat).
  A third `admin` tier can be added later without schema change.
- **Numbering:** Stage 5 = Phases 21–31 (one phase, one test gate, commit before the next).

**Outcome:** every audit P0/P1 resolved, P2 addressed, invites/roles + email +
account-lifecycle shipped, observability + CI + legal in place, and a verified
end-to-end run on the live Vercel URL.

---

## Conventions & critical files

- **Every tenant-scoped DB helper** takes `orgId` first and calls `assertOrgId` —
  `backend/db/index.js`. New tables (`invitations`, `email_verifications`,
  `password_resets`) follow this; add `assertUserId` where `user_id`-scoped.
- **Auth:** `backend/services/auth.js` (JWT, cookie, `validateCredentials`),
  `backend/middleware/requireAuth.js` (`req.auth = {userId, orgId, email}`),
  `backend/routes/auth.js`. New `requireRole()` middleware sits alongside `requireAuth`.
- **Rate limiting:** `backend/services/pgRateStore.js` (the express-rate-limit store,
  `keyPrefix`-namespaced), `backend/middleware/rateLimit.js`. Add more limiters here —
  one `PgRateStore({ prefix })` per endpoint class.
- **Thresholds:** every tunable is a named constant in `backend/config/thresholds.js`.
- **Frontend auth flow:** `frontend/src/components/AuthGate.jsx`, `AuthPage.jsx`,
  `frontend/src/lib/api.js` (thin client, `credentials: 'include'`, `asJson` helper).
- **App shell:** `frontend/src/App.jsx` `Workspace` (header, uploader/wizard, `<Overview>`,
  `<DangerZone>`, `<AscendAiPanel>`).
- **Serverless entry:** `api/index.js` → `backend/app.js`. `backend/index.js` = local dev.
- **Gate pattern:** `backend/scripts/phaseNN-gate.mjs` (live, signs up orgs, hits real
  endpoints) + `frontend/scripts/screenshot-phaseNN.mjs` (Playwright) + the two-process
  cross-instance harness in `backend/scripts/serverless-durability-gate.mjs`.

---

## Phase 21 — Security quick wins & dependency remediation

**Goal:** close the low-risk, high-value findings in one pass; no behavior change for users.

**Tasks**
- Add `SPEC_STAGE5.md` and update `CLAUDE.md` (status; Gemini paid-tier; the Stage 5 rule).
- `helmet` on `backend/app.js`: tight CSP (JSON API — `default-src 'none'`),
  `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy`. HSTS is
  Vercel's.
- 5xx hygiene in the `app.js` error handler: `status >= 500` → generic
  `{ ok:false, error:'Something went wrong. Please try again.' }`; the real error goes to
  `console.error`. `LIMIT_FILE_SIZE` → a clear 413.
- Remove `trace` from the `POST /api/ascendai/chat` response by default — gate it behind
  `ASCENDAI_EXPOSE_TRACE` / non-production so the phase 18/19 gates still inspect it.
- Redact the connection string in `backend/index.js` boot log.
- Delete the unused `SUPABASE_*` vars from `.env` (local, gitignored — user action;
  none in `.env.example`).
- `npm audit fix` for the `qs` moderate advisory (backend); re-lock.
- Repin `xlsx` to the SheetJS vendor distribution
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) in `backend/package.json` +
  root `package.json`; confirm `parseXlsx` round-trips. *(If the environment blocks
  remote installs, this is a user action; the alternative is dropping XLSX support.)*
- Lower `multer` `limits.fileSize` to `4 * 1024 * 1024` in `backend/routes/upload.js`
  (Vercel body cap ≈ 4.5 MB) with a clear 413.

**Test gate**
- `node --test` backend + frontend green.
- `npm audit --omit=dev` — `qs` resolved; only the documented `xlsx` line remains
  (until the CDN repin runs in an unrestricted environment).
- `curl -I` the local app: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` present.
- `POST /api/ascendai/chat` with `NODE_ENV=production` → response has **no** `trace` key;
  without it → `trace` present (gates keep working).
- Upload `fixture_rich_v2.xlsx` → parses and stores as before; a 5 MB file → clean 413.

---

## Phase 22 — Database migrations & schema hygiene

**Goal:** replace request-time `initDb()` DDL with versioned migrations; add cascade
deletes and column guards; prune Stage-1 legacy.

**Tasks**
- `backend/db/migrations/NNN_name.sql` (numbered). `001_init.sql` = the current live
  schema (all tables + indexes exactly as `initDb` builds them).
- `backend/db/migrate.js` — tiny runner: `schema_migrations(version TEXT PK, applied_at)`,
  applies unapplied files in order, each in a transaction. `npm run migrate` (backend +
  root). Idempotent.
- `002_cascades.sql` — `ON DELETE CASCADE` on FKs from `users`, `standardized_data`,
  `mapping_cache`, `chat_messages`, `ascendai_usage`, `pending_uploads` to
  `organizations(id)` / `users(id)`.
- Retire the lazy bootstrap: `backend/app.js` no longer runs `initDb` per request;
  `backend/index.js` runs `migrate`. Keep a fast `SELECT 1` readiness check.
- Prune `backend/db/index.js`: the SQLite→PG branch, the "backfill Demo Nonprofit" block,
  `migrate-sqlite-to-pg.mjs`, the `better-sqlite3` devDep.
- Column guards: cap the **stored** assistant reply (~8 KB) before `insertChatMessage`;
  reject `pending_uploads` payloads > 2 MB in `putPendingUpload`.
- `pruneOldRows()` in `db/index.js` — `chat_messages` > 90 days, `ascendai_usage` >
  400 days. (Cron wiring is Phase 31.)
- Update every `scripts/*-gate.mjs` + `serverless-durability-gate.mjs` to run `migrate`.

**Test gate**
- Fresh DB: `npm run migrate` → every table + index; second run → "0 applied".
- App boots and serves `/api/metrics` with **no** DDL at request time.
- A test org with rows in all 9 tables → deleting the `organizations` row cascades away
  every child row; a second org untouched.
- `node --test` backend + frontend green; `serverless-durability-gate.mjs` passes on the
  migrated schema.
- Oversized pending payload / over-long assistant reply → rejected/truncated.

---

## Phase 23 — Rate limiting on the expensive endpoints

**Goal:** protect every LLM / CPU / parse endpoint, not just auth.

**Tasks**
- New `PgRateStore`-backed limiters in `backend/middleware/rateLimit.js`, each with its
  own `prefix` and `keyGenerator` = `` `${req.auth.orgId}:${req.auth.userId}` ``:
  `insightLimiter` on `GET /api/insight` (~20 / 10 min); `chatBurstLimiter` on
  `POST /api/ascendai/chat` (~8 / min, separate from the per-org daily cap);
  `pdfLimiter` on `GET /api/report.pdf` (~10 / 10 min); `uploadLimiter` on
  `POST /api/upload` + `/api/upload/confirm` (~30 / 10 min).
- Constants in `backend/config/thresholds.js`.
- Responses match existing shapes: 429 `{ ok:false, error }` for hard limits; chat burst
  → `{ ok:true, status:'rate_limited', reply }`.

**Test gate**
- `backend/scripts/phase23-gate.mjs` (two-process harness): each limit fires after its
  threshold with the friendly response; normal usage is never limited; the count is
  shared across instances.
- Existing suites + `serverless-durability-gate.mjs` green.

---

## Phase 24 — Session hardening

**Goal:** revocable sessions — a leaked token stops working on password change / logout-all.

**Tasks**
- Migration: `users.token_version INTEGER NOT NULL DEFAULT 0`.
- `signToken` includes `tv`; `requireAuth` + `/api/auth/me` load the user and reject on
  `payload.tv !== user.token_version`.
- `POST /api/auth/logout-all` — bump `token_version`, clear the cookie.
- Bump `token_version` on any password change (fully wired in Phase 25).
- Shorten `TOKEN_TTL` to `2d`; keep the cookie `maxAge` in sync.

**Test gate**
- `backend/scripts/phase24-gate.mjs`: two clients on one session → one `logout-all` →
  the other's next request → 401; a fresh login works normally.
- `requireAuth` unit coverage for the `tv` mismatch; all existing gates green.

---

## Phase 25 — Transactional email, verification & password reset

**Goal:** real email; verify-on-signup; forgot/reset password; gate risky actions on
verification.

**Tasks**
- `backend/services/email.js` — `sendEmail({ to, subject, html, text })`: Resend adapter
  when `RESEND_API_KEY` set, else a dev logger that prints the message + link.
  `EMAIL_FROM` env. Add `.env.example` entries.
- Migrations: `users.email_verified_at`; `email_verifications(token TEXT PK, user_id,
  expires_at, used_at)`; `password_resets(...)`. Tokens = 32-byte hex, single-use, ~24 h
  (verify) / ~1 h (reset).
- `routes/auth.js`: signup emails a verification link; `POST /api/auth/verify-email`,
  `POST /api/auth/resend-verification` (auth'd), `POST /api/auth/forgot-password`
  (always 200, no enumeration), `POST /api/auth/reset-password` (sets hash, consumes
  token, **bumps `token_version`**, clears cookies).
- `requireVerified` middleware (403 `{ error, needsVerification:true }`) on
  `POST /api/upload`, `/api/upload/confirm`, `POST /api/ascendai/chat`,
  `POST /api/organizations/:id/invitations`, `GET /api/account/export`.
- Password policy in `validateCredentials`: min **10**; HIBP k-anonymity check (range
  API, no dep) on signup + reset; fail **open** if HIBP is unreachable.
- Rate-limit the new `/api/auth/*` endpoints.
- Frontend: persistent "Verify your email" banner + resend when `!emailVerified`;
  "Forgot password?" on `AuthPage`; `/verify-email?token=` + `/reset-password?token=`
  handled via `location.search` (no router). `GET /api/auth/me` returns `emailVerified`.

**Test gate**
- `backend/scripts/phase25-gate.mjs` (dev email logger): signup → token → `verify-email`
  → `emailVerified` true; before verify `POST /api/upload` → 403 `needsVerification`;
  after → works. `forgot-password` → token → `reset-password` → old session 401, new
  password logs in. Unknown email → still 200. Tokens single-use + expiring. Breached
  password → rejected.
- Frontend walkthrough: banner + resend + reset page; 0 console errors.

---

## Phase 26 — Team invites & roles (RBAC)

**Goal:** more than one person per organization, with owner vs member permissions.

**Tasks**
- Migration: `users.role` CHECK in (`'owner'`,`'member'`) (default `'member'`; signup →
  `'owner'`); `invitations(token TEXT PK, org_id, email, role, invited_by_user_id,
  expires_at, accepted_at)` — `assertOrgId`-scoped helpers.
- `requireRole('owner')` middleware.
- `POST/GET/DELETE /api/organizations/:id/invitations` (owner + verified; `:id ===
  req.auth.orgId`); `POST /api/auth/accept-invite` `{ token, password }` → new `users`
  row in the invitation's org + role, marked accepted, logged in, email considered
  verified.
- `requireRole('owner')` on: invitations, member removal
  (`DELETE /api/organizations/:id/members/:userId`), org deletion (Phase 27),
  `DELETE /api/organizations/:id/data`, `GET /api/account/export`.
- Frontend: a "Team" panel (member list, role, remove; invite form; pending invites);
  `/accept-invite?token=` page; owner-only controls hidden for members.
- Confirm nothing assumes one user per org (`chat_messages` / `ascendai_usage` are
  already `(org_id, user_id)` / `org_id` scoped).

**Test gate**
- `backend/scripts/phase26-gate.mjs`: owner invites → invitee accepts → in org A,
  `role='member'`, same `/api/metrics`, independent chat history, shares org A's daily
  cap. Member → 403 on invitations / member-removal / reset / export. Revoked token →
  accept fails. **Cross-org:** an org-A token can't add to org B; an org-A member can't
  read org B.
- Frontend walkthrough: invite → accept in a second context → both see the same data;
  member UI hides owner controls; 0 console errors.

---

## Phase 27 — Account & data lifecycle (delete + export)

**Goal:** a customer can fully delete their organization, and export everything.

**Tasks**
- `DELETE /api/organizations/:id` (owner + verified, `:id === req.auth.orgId`, typed
  org-name confirmation) → one transaction deletes the `organizations` row (Phase 22
  cascades remove all children) + clears the cookie. All that org's sessions die (users
  gone → `requireAuth` `getUserById` → null).
- `GET /api/account/export` (owner + verified) → JSON: `{ organization, members (email,
  role, created_at — no hashes), standardized_data, chat_messages, ascendai_usage,
  invitations }`, `Content-Disposition: attachment`.
- Frontend: Danger Zone gains "Export organization data" + "Delete organization"
  (type-to-confirm, owner-only).

**Test gate**
- `backend/scripts/phase27-gate.mjs`: org with rows in all 9 tables + a second org →
  `DELETE` → every row for that org gone across all tables, second org intact, deleting
  user's next request → 401. `:id` ≠ session org → 403. Export contains all own data,
  **zero** other-org rows, no password hashes.
- Existing suites + `serverless-durability-gate.mjs` green.

---

## Phase 28 — Provider licensing controls, kill-switches & usage visibility

**Goal:** each AI feature can be turned off globally or per-org; confirm paid Gemini;
surface AscendAI usage.

**Tasks**
- Env flags `INSIGHT_ENABLED` / `ASCENDAI_ENABLED` (default true). Disabled → clean
  `{ status:'unavailable', reason }`; frontend hides the insight card / "Ask AscendAI"
  launcher.
- `ASCENDAI_PROVIDER` / `ASCENDAI_MODEL` config so the model/endpoint is swappable.
- Migration: `organizations.ascendai_enabled BOOLEAN NOT NULL DEFAULT true`; chat route
  checks it; `PATCH /api/organizations/:id { ascendaiEnabled }` (owner-only); toggle in
  the settings/Team panel.
- `GET /api/ascendai/usage` → `{ today:{count,limit}, tokens:{prompt,completion,total} }`;
  a small "N of 50 today" line in `AscendAiPanel`.
- `CLAUDE.md` provider note (paid AI Studio = commercial-licensed, not used for training;
  Vertex AI is the future region-pinning option).
- Verify onboarding wizard + tour degrade cleanly with both AI flags off and with the DB
  briefly unreachable.

**Test gate**
- `backend/scripts/phase28-gate.mjs`: `INSIGHT_ENABLED=false` → `/api/insight`
  `unavailable`, rest unaffected; `ASCENDAI_ENABLED=false` → chat `unavailable`, launcher
  hidden. Per-org toggle off for org A → org A chat `unavailable`, org B unaffected.
  `/api/ascendai/usage` accurate. Flags on → identical to today (Phase 18/19 gates pass).
- Frontend walkthrough with flags off: no AI affordances, 0 console errors.

---

## Phase 29 — Observability & resilience

**Goal:** know when something breaks; never white-screen.

**Tasks**
- `@sentry/node` in `backend/app.js` + `@sentry/react` in `frontend/src/main.jsx`, both
  behind `SENTRY_DSN` (no-op when unset). Scrub PII / cookies / tokens.
- `pino` structured request logging in `app.js` with redaction (cookie, `authorization`,
  `DATABASE_URL`, `*_API_KEY`, `password`). One line per request.
- Distinct log/Sentry codes: `GEMINI_FAILURE`, `DEEPSEEK_FAILURE`, `DEEPSEEK_BALANCE_LOW`
  (on a 402 / balance-exhausted response).
- Frontend `<ErrorBoundary>` at the `App` root — friendly reload card, reports to Sentry.
- `GET /api/health` also does `SELECT 1` → `{ status, db:'ok'|'down' }`.

**Test gate**
- `backend/scripts/phase29-gate.mjs`: a forced route throw → structured error log with
  every secret redacted (+ a Sentry event if `SENTRY_DSN` set to a test project); a
  simulated DeepSeek 402 → `DEEPSEEK_BALANCE_LOW`.
- Frontend: a component that throws on render → error-boundary fallback, no white screen,
  no uncaught console error.

---

## Phase 30 — Legal, docs & config guards

**Goal:** the paperwork and guardrails a commercial launch needs.

**Tasks**
- `/legal/terms` + `/legal/privacy` SPA pages (linked from footer + signup). **Draft**
  ToS + Privacy copy tailored to this app's data flows, each headed `DRAFT — NOT LEGAL
  ADVICE — needs review by counsel`.
- Sub-processor list: Google (Gemini, paid), DeepSeek, Supabase, Vercel, Resend, Sentry
  — purpose + data category each.
- Cookie notice (single first-party session cookie).
- Signup "I agree to the Terms & Privacy Policy" checkbox, **enforced server-side**;
  migration `users.tos_accepted_at`.
- Production config guard in `backend/app.js`: on boot in production, loud ERROR (+
  `Sentry.captureMessage`) if `JWT_SECRET` (len ≥ 32), `DATABASE_URL`, `RESEND_API_KEY`,
  `CORS_ORIGINS` is missing/weak. Don't hard-crash — health stays up.
- `README.md` ops runbook: local setup, `npm run migrate`, deploy, full env-var
  reference, rotate `JWT_SECRET` (bump all `token_version`), restore from backup,
  provider-outage playbook, the gate-script catalogue.

**Test gate**
- Legal pages render + linked from footer/signup; signup without the checkbox → 400;
  with it → `tos_accepted_at` set.
- Boot with a deliberately-missing prod var → the loud warning fires; health still 200.
- README covers every runbook item.

---

## Phase 31 — CI, accessibility, bundle & paid-infra cutover + live verification

**Goal:** automated checks, an accessible + lighter frontend, production infrastructure,
and a verified end-to-end run on the live URL.

**Tasks**
- `.github/workflows/ci.yml`: on PR + main — backend `node --test`, frontend `node
  --test`, `vite build`, `npm audit --omit=dev`, and the Postgres-backed gates against a
  `postgres:18` service container (`npm run migrate` first). Red = fail.
- Accessibility: axe + Lighthouse; fix AA blockers — form labels, focus management +
  `aria-modal` on the tour / mapping-confirmation / AscendAI dialogs, contrast, keyboard
  traps. Target a11y ≥ 95.
- Bundle: `React.lazy` + `Suspense` for Recharts-heavy cards and the onboarding
  wizard/tour; report the initial-chunk drop (was 627 KB / 187 KB gz).
- Retention cron: Vercel Cron (`vercel.json` `crons`) → `POST /api/internal/prune`
  (guarded by a `CRON_SECRET` header) → `pruneOldRows()`.
- Infra: paid Supabase (PITR on) / paid Neon; `pg` pool `max` to the plan's per-instance
  share; Vercel env for **Production + Preview** (`DATABASE_URL`, `JWT_SECRET`,
  `GEMINI_API_KEY` paid, `DEEPSEEK_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`,
  `CORS_ORIGINS`, `CRON_SECRET`); run `npm run migrate` against the prod DB; Deployment
  Protection decision; optional custom domain (+ `CORS_ORIGINS`).

**Test gate**
- CI green on a test PR (all jobs).
- Lighthouse a11y ≥ 95 on the dashboard, auth page, and with the AscendAI panel open;
  keyboard-only walkthrough works.
- Initial JS chunk materially smaller (before/after gzip reported).
- **Live, on the deployed URL:** signup → verify email → invite a teammate → accept →
  upload `fixture_rich_v2.csv` → dashboard → AscendAI multi-turn with traceable numbers
  → PDF export → data export → a second org proves cross-org isolation → owner deletes
  org A → all traces gone. Two rapid `/api/auth/login` attempts from one IP confirm the
  DB-backed limit holds across lambdas. **Zero** console/page errors.

---

## Verification (how each gate is run)

- **Unit:** `cd backend && node --test`, `cd frontend && node --test`. New route logic
  gets DB-mocked route tests following `backend/test/routes*.test.js`.
- **Live phase gates:** `node backend/scripts/phaseNN-gate.mjs [baseUrl]` — signs up real
  orgs against a running backend + local Postgres. Model on `phase18/19-gate.mjs`.
- **Cross-instance:** `node backend/scripts/serverless-durability-gate.mjs` — two backend
  processes on one DB; rate-limit / shared-state gates reuse this harness.
- **Frontend walkthroughs:** `node frontend/scripts/screenshot-phaseNN.mjs <appUrl>
  <outDir> <repoRoot>` — Playwright, asserts 0 console/page errors.
- **Email:** `services/email.js` dev logger prints tokens/links; gates scrape them.
- **Live deploy:** `curl` + a Playwright pass against the Vercel URL (Phase 31).
- **Per phase:** run the gate, paste results, commit with the short hash in the report,
  stop for confirmation before the next phase.
