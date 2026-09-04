# Stage 5 — Phase 31 launch checklist

Everything codeable in Phase 31 is done and gated (`node backend/scripts/phase31-gate.mjs`).
The items below need your machine, a browser, or account credentials, so they are
a hand-off rather than an automated gate. Work top to bottom.

---

## 1. Paid infrastructure cutover

### Supabase
- [ ] Upgrade the project to a **paid plan** (Pro or above) so Point-in-Time
      Recovery / daily backups are enabled. (Neon paid is an equivalent option.)
- [ ] Confirm **PITR / daily backups** are on under Database → Backups.
- [ ] Note the **Session pooler** connection string
      (`postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`).
      Do **not** use the direct connection (IPv6-only, unreachable from Vercel).
- [ ] Decide the `pg` pool size. `backend/db/index.js` already caps `max: 2`
      under `VERCEL`; raise it only if the plan's connection budget comfortably
      exceeds `2 × expected concurrent lambdas`.

### Google AI Studio (Gemini)
- [ ] Confirm billing is enabled on the key in `GEMINI_API_KEY` (paid AI Studio
      tier — commercial-licensed, inputs not used for training).

### DeepSeek
- [ ] Top up the prepaid balance. There is **no auto-recharge** by design; the
      balance is the spend ceiling. `DEEPSEEK_BALANCE_LOW` fires in the logs at
      a 402.

### Resend
- [ ] Verify the sending domain, set `EMAIL_FROM` to an address on it.
- [ ] **`POST /api/auth/forgot-password` sends its reset email in a
      fire-and-forget background block** (so the response time is identical for
      a real vs unknown email — no user enumeration by timing). On Vercel the
      function *may* be frozen once the response is flushed, which could drop
      that background work. Before relying on it: wrap the background block in
      `waitUntil()` from `@vercel/functions` (or move the send to a queue).
      Until then it's low-severity — a lost email just means the user requests
      another link — but confirm reset emails actually arrive in the live
      end-to-end run (§4).

### Sentry (optional)
- [ ] Create a project, set `SENTRY_DSN`.
- [ ] `cd backend && npm i @sentry/node` (blocked in the dev sandbox; do it on
      your machine). `services/observability.js` picks it up automatically.
- [ ] Add a Sentry browser loader `<script>` + DSN to `frontend/index.html` if
      you want the `ErrorBoundary` to report client crashes
      (`window.Sentry.captureException`).

---

## 2. Vercel project settings

Set these for **Production _and_ Preview** (Project → Settings → Environment
Variables). See `README.md` for what each does.

- [ ] `DATABASE_URL` — Supabase Session pooler string
- [ ] `JWT_SECRET` — ≥ 32 random chars
      (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
- [ ] `APP_BASE_URL` — the deployed URL
- [ ] `CORS_ORIGINS` — the deployed URL (+ any custom domain)
- [ ] `GEMINI_API_KEY` (billing-enabled)
- [ ] `DEEPSEEK_API_KEY`
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`
- [ ] `SENTRY_DSN` (if used)
- [ ] `CRON_SECRET` — random; the cron in `vercel.json` authorizes with it
      automatically
- [ ] (optional) `INSIGHT_ENABLED` / `ASCENDAI_ENABLED` — leave unset for "on"

Then:
- [ ] Boot a preview deploy and check the function logs for the
      **`PRODUCTION CONFIG PROBLEM`** banner. It must **not** appear — if it
      does, a var above is missing or weak.
- [ ] Run migrations against production:
      `DATABASE_URL="<session pooler>" npm run migrate`
- [ ] Confirm the cron is registered (Project → Settings → Cron Jobs shows
      `/api/internal/prune` daily at 04:00). Trigger it once manually and check
      it returns `{ ok: true, pruned: {...} }`.
- [ ] Decide **Deployment Protection** (Vercel Authentication / password) for
      preview deploys.
- [ ] (optional) Add a custom domain; add it to `CORS_ORIGINS`.

---

## 3. Accessibility verification (target: Lighthouse a11y ≥ 95)

Code fixes already in: `aria-modal` + focus-on-open + Escape-close on the
AscendAI panel, `aria-modal` on the tour, region labels on the wizard and
mapping-confirmation panels, `<label>`-wrapped inputs throughout, `role="alert"`
on error text.

- [ ] Run Lighthouse (Chrome DevTools → Lighthouse → Accessibility) on:
      the **dashboard**, the **auth page**, and the dashboard with the
      **AscendAI panel open**. Record the scores.
- [ ] Run **axe DevTools** on the same three; fix any serious/critical issues
      (most likely: colour contrast on `--text-muted` / status colours against
      `--surface-1`). Adjust the tokens in `frontend/src/index.css` if contrast
      is below 4.5:1 for body text / 3:1 for large text.
- [ ] **Keyboard-only pass:** tab through sign-in → dashboard → open a card's
      (i) popover → open AscendAI, send a message, Escape to close → open the
      tour, Next/Skip. No focus traps, every control reachable, focus visible.
- [ ] If any score is < 95, fix and re-run.

---

## 4. Live end-to-end verification (on the deployed URL)

Do this in a real browser with the DevTools console open. **Zero** console or
page errors are allowed at any point.

- [ ] **Sign up** org A → land on the dashboard → the "verify your email"
      banner shows.
- [ ] Open the verification email (Resend), click the link → banner clears.
- [ ] **Invite** a teammate (Team panel) → open the invite email in a separate
      browser profile → accept → both sessions see the same (empty) dashboard.
- [ ] Upload `data/fixture_rich_v2.csv` → the dashboard renders health cards,
      the revenue-by-source bar, trends. The Recharts chunk loads on demand
      (Network tab: a `CartesianChart` / chart chunk fetched only now).
- [ ] **AscendAI** multi-turn: ask "what's my cash runway?", then a follow-up.
      Numbers in the replies trace to the dashboard. The "N of 50 today"
      counter increments.
- [ ] **PDF export** downloads a real `%PDF` file.
- [ ] **Data export** (Danger zone) downloads the JSON bundle; spot-check it
      has this org's data and no password hashes.
- [ ] **KNOWN LIMIT — export size.** `GET /api/account/export`
      (`db.exportOrganizationData`) builds the whole bundle in memory and
      `res.send`s it as one `JSON.stringify(..., null, 2)` string — it does not
      stream. Vercel caps a serverless **response** body at ~4.5 MB (the same
      limit `upload.js` documents for the request side). An organisation with
      years of monthly `standardized_data` plus heavy AscendAI chat history can
      exceed that, and the failure is an opaque platform error, not a clean
      message. Mitigations for now: the endpoint is owner-only + verified +
      rate-limited (`exportLimiter`, 10 / 10 min). If a real customer's export
      approaches the cap, switch the route to a streamed JSON response (or a
      pre-signed object-storage download) before it bites. Track the largest
      real export size once there is production data.
- [ ] **Second org B** in another profile: sign up, upload different data.
      Confirm from org A you cannot see org B's data and the org-A invite link
      cannot add anyone to org B.
- [ ] **Auth limiter — IP keying can only be checked live.** `authLimiter`
      (10 / 15 min on `POST /api/auth/login` + `/signup`) is keyed by `req.ip`,
      which behind Vercel's proxy is derived from `X-Forwarded-For` via
      `app.set('trust proxy', 1)`. Local/gate testing is structurally unable to
      exercise per-IP isolation — every request is `127.0.0.1`, one bucket — so
      the gates only prove the shared-count behavior. On the deployed URL:
      1. from IP #1, hammer `POST /api/auth/login` (wrong password) ~12× →
         expect a `429` once the 10th is exceeded;
      2. immediately from a **different** IP (phone off wifi, or a second
         network), one `POST /api/auth/login` → must be `200`/`401`, **not**
         `429` (proves the bucket is per-IP, i.e. `X-Forwarded-For` is being
         read, not a single shared/global bucket and not the proxy's own IP);
      3. check a function log line for one of these requests shows the real
         client IP, not a Vercel edge IP.
      Do not trust `authLimiter` in production until 1–3 pass.
- [ ] The four Phase-23 limiters (`insight` / `pdf` / `upload` / `chat-burst`)
      are keyed per **org + user**, not IP, so they don't have this caveat —
      but still confirm one fires on the deployed URL (e.g. 21 rapid
      `GET /api/insight` → `429`) to prove the shared Postgres counter works
      across real lambdas.
- [ ] **Delete org A** (Danger zone, type-to-confirm) → signed out; sign back
      in is impossible (account gone); org B is untouched.
- [ ] Kill-switch smoke: set `ASCENDAI_ENABLED=0` in Vercel, redeploy → the
      "Ask AscendAI" launcher is gone, the dashboard is otherwise identical.
      Revert.

---

## 5. CI

`.github/workflows/ci.yml` runs on every PR + push to `main`:

- `unit` job: backend `node --test`, frontend render-smoke, frontend build,
  `npm audit --omit=dev --audit-level=high` (both packages).
- `gates` job: `postgres:18` service container, `npm run migrate`, then the
  serverless-durability gate and `phase22`–`phase31` gates.

- [ ] Open a throwaway PR and confirm both jobs go green.
- [ ] If `phase25-gate` is flaky in CI (it calls the live Have I Been Pwned
      API), that's the only network dependency — re-run, or gate it behind a
      `secrets`-guarded conditional.

---

## Stage 5 close-out

When 1–5 are checked: every audit P0/P1 is resolved, invites/roles + email +
account-lifecycle are shipped, observability + CI + legal are in place, and the
deployed URL has been verified end to end. Update `CLAUDE.md`'s project-status
line to mark Stage 5 complete.
