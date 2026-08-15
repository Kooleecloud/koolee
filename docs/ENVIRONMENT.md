# Environment & Credentials

> **Canonical reference for every environment variable in this repo.** Baseline:
> `origin/dev` @ `b17a7de`. Related: [MIGRATIONS.md](MIGRATIONS.md) ·
> [SCRIPTS.md](SCRIPTS.md) · [CODEBASE-MAP.md](CODEBASE-MAP.md)
>
> **No secret values live in this file**, by design. It documents *what* each
> var is, *which app needs it*, *where to obtain it*, and *what silently breaks
> without it*.

---

## 1. The contract — read this first

Three rules explain almost every surprising thing about env in this repo.

**1.1 — Importing `env.ts` never throws.** Every var is `optional().catch(undefined)`
at parse time. A malformed value degrades to `undefined` with a dev warning
rather than crashing. This is deliberate: `pnpm install && pnpm build && pnpm
lint && pnpm typecheck && pnpm test` must all pass on a fresh clone with **zero
credentials**.

**1.2 — A var becomes required only when a code path that needs it runs.**
`requireEnv(key)` throws a `MissingEnvError` naming the variable *and where to
get it* ([web/src/env.ts:181](../apps/web/src/env.ts#L181)). `optionalEnv(key)`
is the non-throwing read.

**1.3 — Missing credentials degrade to a documented fallback, not an error.**
Each app ships `describeEnvStatus()` listing every service, whether it's
configured, and exactly what happens without it — surfaced in a dev-only
`<EnvStatus />` panel and a one-shot console warning.

⚠️ **The consequence to internalise:** in this codebase a missing secret does
not look like a failure. It looks like a *working app with a protection turned
off*. That is why the production boot gates in §4 exist.

---

## 2. Where env files actually live

**Next.js does not read the root `.env.local`.** Each app reads only its own.

| File | Read by | Tracked? | Purpose |
| --- | --- | --- | --- |
| `.env.example` (root) | nobody | ✅ | Canonical reference of where every key comes from |
| `apps/web/.env.local` | `apps/web` | ❌ | Live values for the customer app |
| `apps/agent/.env.local` | `apps/agent` | ❌ | Live values for the agent PWA |
| `apps/admin/.env.local` | `apps/admin` | ❌ | Live values for the ops console |
| `packages/db/.env` | `drizzle-kit`, `migrate.ts`, `status.ts`, `seed.ts` | ❌ | **Points at the HOSTED project** — see §6 |
| `.env.test` (root) | integration suites | ❌ | **Generated** by `test-env.sh up`. Do not hand-edit |

Each app also has its own `apps/<app>/.env.example` — **those are the accurate
ones**. Copy them:

```bash
cp apps/web/.env.example   apps/web/.env.local
cp apps/agent/.env.example apps/agent/.env.local
cp apps/admin/.env.example apps/admin/.env.local
```

⚠️ **The root `.env.example` is stale.** It is missing five vars that
`apps/web/src/env.ts` actually reads: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`OTP_LOG_HMAC_KEY`, `CRON_SECRET`, `AUTH_SCHEMA_AVAILABLE`, and admin's
`NEXT_PUBLIC_AGENT_APP_URL`. Trust the per-app examples and the `env.ts` files
over the root template until it is refreshed.

---

## 3. The full matrix

Legend: ● required for the feature to work · ○ optional/degrades · — not read.

| Variable | web | agent | admin | Where to get it |
| --- | :-: | :-: | :-: | --- |
| `NEXT_PUBLIC_APP_URL` | ○ | ○ | ○ | Own origin. Dev: `:3000` / `:3001` / `:3002` |
| `NEXT_PUBLIC_AGENT_APP_URL` | — | — | ● | Agent app's origin. Invite links land there |
| `DATABASE_URL` | ● | ● | ● | Supabase → Settings → Database → **Connection pooling, Transaction mode, port 6543** |
| `DIRECT_DATABASE_URL` | ○ | ○ | ○ | Same page → **Direct connection, port 5432**. Migrations only |
| `NEXT_PUBLIC_SUPABASE_URL` | ● | ● | ● | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ● | ● | ● | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ● | **—** | ● | Supabase → Settings → API → service_role. **Never in agent** (§5) |
| `AUTH_SCHEMA_AVAILABLE` | ○ | — | — | `"false"` only for bare local Postgres with no GoTrue |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ● | — | — | Cloudflare → Turnstile → Site key (invisible mode) |
| `OTP_LOG_HMAC_KEY` | ● | — | — | `openssl rand -hex 32`. **Min 32 chars** |
| `CRON_SECRET` | ● | — | — | Any random string. Protects `/api/jobs/*` |
| `STRIPE_SECRET_KEY` | ● | — | ○ | Stripe → Developers → API keys (admin needs it for refunds) |
| `STRIPE_WEBHOOK_SECRET` | ● | — | — | Stripe → Webhooks, or `stripe listen` locally |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ● | — | — | Stripe → Developers → API keys |
| `INNGEST_EVENT_KEY` | ○ | — | — | Inngest Cloud → Events. Not needed for `pnpm dev:inngest` |
| `INNGEST_SIGNING_KEY` | ○ | — | — | Inngest Cloud → Deploy → Signing key |
| `RESEND_API_KEY` | ○ | — | — | Resend dashboard |
| `AEROAPI_KEY` | ○ | — | — | FlightAware AeroAPI. **Stubbed** |
| `GOOGLE_MAPS_API_KEY` | ○ | ○ | — | Google Cloud → Maps Platform. **Stubbed** |
| `ANTHROPIC_API_KEY` | ○ | — | — | Ticket-PDF extraction. Out of scope in scaffold |
| `SENTRY_DSN` | ○ | ○ | ○ | Sentry project settings |
| `TEST_DATABASE_URL` | — | — | — | Integration tests only. See [SCRIPTS.md](SCRIPTS.md) |

Source of truth: [apps/web/src/env.ts](../apps/web/src/env.ts) ·
[apps/agent/src/env.ts](../apps/agent/src/env.ts) ·
[apps/admin/src/env.ts](../apps/admin/src/env.ts)

---

## 4. Fail-closed boot gates

Rule 1.1 says nothing throws. **These are the exceptions** — and each one exists
because a missing var silently disables a *security control*.

### 4.1 — `OTP_LOG_HMAC_KEY`, validated at import

Fires whenever `DATABASE_URL` is set, server-side only
([web/src/env.ts:204](../apps/web/src/env.ts#L204)). With a database configured
the OTP throttle **will** write `destination_hash` rows, so a missing or
under-32-char key must fail at env validation, not at the first OTP send. A
fresh clone with no `DATABASE_URL` still boots green.

### 4.2 — `assertProductionSecurityConfig()` — apps/web

Runs when `isProd && NEXT_PUBLIC_SUPABASE_URL` is set
([web/src/env.ts:241](../apps/web/src/env.ts#L241)). Refuses to boot if any of:

| Missing | Silently disables |
| --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No widget mounts → `requireCaptchaToken` never demands a token → **CAPTCHA off across the whole funnel** |
| `SUPABASE_SERVICE_ROLE_KEY` | `deleteAuthUser` becomes a logged no-op → orphaned GoTrue users survive → reinstates the `phone_change` collision bug |
| `DATABASE_URL` | `guardUpgradeSend` degrades to allow-all → **no OTP throttle, no reconciliation**, while Supabase still sends real SMS |
| `AUTH_SCHEMA_AVAILABLE="false"` | Reconciliation explicitly skipped — a dev-only posture |

### 4.3 — `assertProductionBootConfig()` — agent & admin

Agent ([agent/src/env.ts](../apps/agent/src/env.ts)): refuses without Supabase
URL + anon key — staff sign-in *is* that app, and without them every page
degrades to an unusable login screen.

Admin ([admin/src/env.ts](../apps/admin/src/env.ts)): also requires
`SUPABASE_SERVICE_ROLE_KEY` (staff invites and evidence-photo signed URLs become
no-ops) and `NEXT_PUBLIC_AGENT_APP_URL` (agent invite links would land on the
wrong app).

### 4.4 — Why builds still pass

`next build` runs with `NODE_ENV=production`. The agent and admin gates are
exempted via `process.env.NEXT_PHASE !== "phase-production-build"`, so a
credential-less fresh clone still builds. The gates fire when a production
**server** boots.

🧭 **A failed boot assertion is the intended outcome of a missing secret, not a
bug to work around.** Do not add a bypass flag.

---

## 5. Secrets that must NOT be in app env

**5.1 — Twilio / SMS credentials for auth OTP.** Owned entirely by Supabase Auth.
They live in the Supabase dashboard and never in any `.env`. The app calls
Supabase; Supabase calls Twilio.

**5.2 — The Turnstile *secret* key.** Only the **site** key is app env. The
secret lives in Supabase dashboard → Auth → Attack Protection. Supabase verifies
the `captchaToken` the app forwards, so **this app never calls `siteverify`**.

**5.3 — `SUPABASE_SERVICE_ROLE_KEY` in `apps/agent`.** Deliberately absent, and
this is a design decision, not an oversight: the agent app runs on a shared,
frequently-lost field device. It authenticates as the signed-in agent via the
anon key, and bag-photo uploads are authorized by **Storage RLS** — which is the
only authorization mechanism available there precisely *because* there is no
service key ([agent/src/env.ts describeEnvStatus](../apps/agent/src/env.ts)).

---

## 6. ⚠️ The sharpest edge: `packages/db/.env` points at HOSTED

`packages/db/.env` currently resolves to a **hosted Supabase pooler**
(`aws-0-ca-central-1.pooler.supabase.com`).

Every db tool loads dotenv in this order —
`.env.local`, `.env`, `../../.env.local`, `../../.env` — so a **bare**
`pnpm db:migrate`, `pnpm db:status`, `pnpm seed`, or `pnpm db:studio` targets
the **hosted project**, not your local stack.

**The guard:** shell env always wins. `migrate.ts`, `status.ts`, and
`drizzle.config.ts` each capture `process.env.DIRECT_DATABASE_URL` /
`DATABASE_URL` *before* calling dotenv, so an inline override beats every dotenv
file ([migrate.ts:15-21](../packages/db/src/migrate.ts#L15-L21)).

```bash
# Targets LOCAL — pin the URL explicitly.
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm db:migrate
```

**Both `migrate.ts` and `status.ts` print `Target host:` before doing anything.**
Read that line. It exists specifically so "migrations silently landed on the
wrong database" is visible rather than discovered later.

`pnpm seed:local` is the safe one-command version — it pins both URLs at the
local stack before anything reads the environment.

---

## 7. Setting up from scratch

```bash
# 1. Per-app env files
cp apps/web/.env.example   apps/web/.env.local
cp apps/agent/.env.example apps/agent/.env.local
cp apps/admin/.env.example apps/admin/.env.local

# 2. Generate the one secret you create yourself
openssl rand -hex 32          # → OTP_LOG_HMAC_KEY (apps/web only)

# 3. Fill from dashboards, in this priority order:
#    Supabase (URL, anon, service_role, both DB URLs) → the app is inert without these
#    Stripe   (secret, publishable, webhook)          → absent = FakePaymentProvider
#    Cloudflare Turnstile site key                    → absent = CAPTCHA off
#    Everything else is optional and has a fallback
```

For local development you generally want the **local Supabase stack** instead of
hosted credentials — see [SCRIPTS.md](SCRIPTS.md) §2.

---

## 8. Diagnosing env problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| App boots, feature silently absent | Var missing, degraded to fallback | Check the dev `<EnvStatus />` panel or the startup console warning |
| `MissingEnvError: Missing required environment variable X` | A code path needed X | The error message names the dashboard page. Set it |
| Production boot refuses with a list | §4 gate fired | Set the listed vars. **Do not bypass** |
| `prepared statement "s1" does not exist` | Pooled URL used for migrations | Use `DIRECT_DATABASE_URL` (port 5432) |
| Migration hit the wrong database | §6 — dotenv resolved to hosted | Read the `Target host:` line; pin the URL inline |
| Hostname did not resolve (`ENOTFOUND`) | Supabase direct connection is IPv6-only | Use the **session pooler** on port 5432: `aws-0-<region>.pooler.supabase.com` |
| Var set but not visible in browser | Not prefixed `NEXT_PUBLIC_` | Only `NEXT_PUBLIC_*` is inlined into client bundles |
| Root `.env.local` edited, nothing changed | Next reads only `apps/<app>/.env.local` | Edit the per-app file |
