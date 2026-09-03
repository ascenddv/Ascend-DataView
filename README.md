# AscendDV — Ascend Dataview

An analytics platform for organizations with messy or incomplete data. It ingests
raw figures, computes only the metrics the data can support, and renders only the
dashboard cards it can substantiate. **Graceful degradation is the core
principle** — sparse data or an unavailable AI provider produces a smaller,
still-coherent experience, never an error, an empty chart, or a fabricated
number.

- **Backend:** Node.js + Express 5, Postgres (`pg`), JWT cookie auth. No ORM;
  hand-written SQL helpers, all tenant-scoped by `org_id`.
- **Frontend:** React 19 + Vite 7 + Tailwind v4 + Recharts. No router — a few
  landing pages are dispatched by `location.pathname` in `AuthGate`.
- **Deploy target:** one Vercel project — the static frontend plus the Express
  app as a single serverless function at `/api`. Postgres is Supabase.

---

## Local setup

Prerequisites: Node 20+, a local Postgres 16+ (the code defaults to a cluster on
`127.0.0.1:5433`, database `ascenddv`).

```bash
git clone <repo> && cd Ascend-DataView
cp .env.example .env            # fill in secrets; defaults are fine for local dev

createdb -p 5433 ascenddv       # or: psql -p 5433 -c 'CREATE DATABASE ascenddv'
npm run migrate                 # apply backend/db/migrations/*.sql in order

# two terminals:
npm run dev:backend             # http://localhost:3001  (node --watch)
npm run dev:frontend            # http://localhost:5173  (Vite; proxies /api -> :3001)
```

With `RESEND_API_KEY` unset, verification / reset / invite emails are printed to
the backend console (link included) instead of sent — enough to complete every
flow locally.

### Tests

```bash
npm test                        # backend (node --test) + frontend (render-smoke)
```

Everything is dependency-light and offline: the frontend "render-smoke" bundles
components with esbuild and renders them to static markup, asserting structure
and that no `NaN` / `undefined` leaks into the DOM.

---

## Migrations

Numbered SQL files in `backend/db/migrations/` plus a tiny runner
(`backend/db/migrate.js`, no dependency). A `schema_migrations` table records
what has run; each file is applied once, inside a transaction.

```bash
npm run migrate                 # apply anything unapplied (idempotent)
npm run migrate                 # again -> "schema is up to date (0 applied)"
```

The runner also **fails** if a field in `backend/config/schema.js` has no
matching `standardized_data` column — add a new numbered migration when you add a
canonical field.

**Adding a migration:** create `backend/db/migrations/NNN_short_name.sql` with
`NNN` the next number. Use `IF NOT EXISTS` / `IF EXISTS` guards so it is safe to
run against a database that predates the migration system.

**Retention prune** (chat > 90d, usage > 400d, expired tokens/uploads):

```bash
npm run prune                   # wired to a cron in Phase 31
```

---

## Deploy to Vercel

One project, root of the repo. `vercel.json` already declares:

- `buildCommand: npm run build` → builds `frontend/dist`
- `outputDirectory: frontend/dist`
- the Express app is bundled as the function `api/index.js`
  (`module.exports = require('../backend/app.js')`)
- rewrites: `/api/:path*` → the function, everything else → `index.html`

**Vercel never runs migrations.** After deploying a change that includes a new
migration, run it against the production database yourself:

```bash
DATABASE_URL="<supabase session-pooler URL>" npm run migrate
```

Set env vars for **Production and Preview** in the Vercel dashboard (see the
table below). `NODE_ENV=production` is set by Vercel automatically; the app also
detects `VERCEL`.

---

## Environment variables

| Var | Required | Where | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | local `.env` + Vercel | Postgres connection. In production use the Supabase **Session pooler** string (`postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`), not the direct connection (IPv6-only, unreachable from Vercel). `POSTGRES_URL` is accepted as a fallback. |
| `JWT_SECRET` | yes | local `.env` + Vercel | Signs the session cookie. Must be ≥ 32 random chars in production; the config guard complains otherwise. |
| `APP_BASE_URL` | prod | Vercel | Origin used to build links inside emails. Set to the deployed URL. Defaults to `http://localhost:3001`. |
| `CORS_ORIGINS` | prod | Vercel | Comma-separated allowlist for cross-origin API calls. Not exercised on a same-origin Vercel deploy, but the config guard wants it set. |
| `GEMINI_API_KEY` | for insight | local `.env` + Vercel | Google Gemini, **paid AI Studio tier** (commercial-licensed, inputs not used for training). Powers `generateInsight()` + column mapping. Unset → the insight card is simply absent. |
| `DEEPSEEK_API_KEY` | for AscendAI | local `.env` + Vercel | DeepSeek (`deepseek-chat`). Powers AscendAI chat only. **Prepaid balance, no auto-recharge** — the balance is the spend ceiling. Separate failure domain from Gemini. |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` / `ASCENDAI_MODEL` | no | — | Repoint the AscendAI provider/model without code. `ASCENDAI_MODEL` is an alias for `DEEPSEEK_MODEL`. |
| `RESEND_API_KEY` | prod | Vercel | Resend, for transactional email. Unset → emails are logged to the console instead of sent. |
| `EMAIL_FROM` | prod | Vercel | Sender identity, e.g. `AscendDV <noreply@yourdomain>`. |
| `SENTRY_DSN` | optional | Vercel | If set **and** `@sentry/node` is installed, 5xx + provider failures are forwarded to Sentry (secrets redacted). Otherwise the structured stderr log is the only sink. |
| `INSIGHT_ENABLED` / `ASCENDAI_ENABLED` | optional | Vercel | Global kill-switches. Default on; `0`/`false`/`off` returns a clean `unavailable` and hides the affordance. |
| `HIBP_CHECK_ENABLED` | optional | — | `0`/`false` skips the Have I Been Pwned breached-password check (offline installs / HIBP outage). Default on; fails open on error regardless. |
| `CRON_SECRET` | Phase 31 | Vercel | Guards the internal prune endpoint the retention cron calls. |

The per-org AscendAI toggle (`organizations.ascendai_enabled`) is data, not env —
an owner flips it from the Team panel.

---

## Runbooks

### Rotate `JWT_SECRET`

Changing the secret invalidates every existing session (all tokens fail
signature verification), which is the desired effect. There is no need to touch
`token_version` — that column is for *selective* revocation (logout-all, password
reset). Steps:

1. Generate a new secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
2. Update `JWT_SECRET` in Vercel (Production + Preview) and redeploy.
3. All users are signed out and log in again. No migration, no data change.

If you additionally want to be certain no pre-rotation token can ever be
replayed even against a mistakenly-kept old secret, bump every user's token
version:

```sql
UPDATE users SET token_version = token_version + 1;
```

### Restore from a Supabase backup

1. Supabase dashboard → Database → Backups → pick a point-in-time or a daily
   snapshot → restore into a new project (or in place if you accept the
   downtime).
2. Point `DATABASE_URL` at the restored database (Session pooler string).
3. `npm run migrate` — a restore predating a migration will re-apply the missing
   ones; an up-to-date restore is a no-op.
4. Redeploy so serverless instances pick up the new connection string.

Because every foreign key is `ON DELETE CASCADE` from the organization down, a
partial restore of just one org's rows is not supported — restore the whole
database.

### Provider-outage playbook

| Outage | Symptom | Expected behavior | Action |
|---|---|---|---|
| **Supabase down** | `/api/health` returns `{ db: "down" }`; API requests 500 with a generic message | The frontend shows its error boundary or the failed fetch's own message; no secrets leak (`ROUTE_5XX` logged, DSN redacted) | Check Supabase status; the app recovers on its own when the DB is back (the readiness check retries per request) |
| **Gemini down / quota** | Insight card missing; `GEMINI_FAILURE` in the logs | Dashboard renders fully without the narrative; PDF export still works | None required; confirm the paid AI Studio key still has billing enabled |
| **DeepSeek down** | AscendAI replies with a friendly "temporarily unavailable"; `DEEPSEEK_FAILURE` in the logs | Rest of the dashboard unaffected | None required |
| **DeepSeek balance exhausted** | Same as above; `DEEPSEEK_BALANCE_LOW` in the logs (a 402) | AscendAI unavailable; nothing else affected | Top up the prepaid DeepSeek balance manually (no auto-recharge by design) |
| **Resend down** | Verification / reset / invite emails not delivered | Signup still succeeds; the user can re-request the link; `EMAIL_SEND_FAILURE` logged | Check Resend status; the flows are all re-triable |

To take an AI feature down deliberately, set `INSIGHT_ENABLED=0` or
`ASCENDAI_ENABLED=0` in Vercel (no deploy needed if you use the dashboard's
instant env update + redeploy).

---

## Verification gates

Live end-to-end checks. Each spins real backend process(es) against the local
Postgres, drives real HTTP, and asserts on real responses. Run from `backend/`:

```bash
cd backend
node scripts/serverless-durability-gate.mjs   # rate limiter + pending uploads shared across 2 instances
node scripts/phase22-gate.mjs                 # migrations + cascade deletes + no request-time DDL
node scripts/phase23-gate.mjs                 # per-endpoint rate limits
node scripts/phase24-gate.mjs                 # revocable sessions (logout-all)
node scripts/phase25-gate.mjs                 # email verification, password reset, requireVerified wall
node scripts/phase26-gate.mjs                 # team invites + owner/member RBAC
node scripts/phase27-gate.mjs                 # org delete (full cascade) + data export
node scripts/phase28-gate.mjs                 # AI kill-switches + per-org toggle + usage
node scripts/phase29-gate.mjs                 # request logging, secret redaction, provider-failure codes, /health db probe
node scripts/phase30-gate.mjs                 # signup ToS consent + production config guard
```

Earlier Stage 1–4 gates (`phase9`–`phase19`, `verify-isolation.mjs`,
`verify-prompt-safety.mjs`, `trace-dimension.mjs`) still run and cover the
metrics/eligibility/AI-safety layer.

CI wiring for all of these against a `postgres` service container is Phase 31.

---

## Project docs

- `CLAUDE.md` — the authoritative context: product principle, health-scoring
  formula and bands, AscendAI architecture, cost controls, kill-switches.
- `SPEC_STAGE4.md` — the AscendAI build plan (done).
- `SPEC_STAGE5.md` — Production Hardening, Phases 21–31 (in progress).
