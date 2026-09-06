# Environment & Credentials

> **Canonical reference for every environment variable in this repo.** Baseline:
> `dev` @ `5db21a4`. Related: [MIGRATIONS.md](MIGRATIONS.md) ·
> [SCRIPTS.md](SCRIPTS.md) · [CODEBASE-MAP.md](CODEBASE-MAP.md)
>
> **No secret values live in this file**, by design. It documents _what_ each
> var is, _which app needs it_, _where to obtain it_, and _what silently breaks
> without it_.

---

## 1. The contract — read this first

Three rules explain almost every surprising thing about env in this repo.

**1.1 — Importing `env.ts` never throws.** Every var is `optional().catch(undefined)`
at parse time. A malformed value degrades to `undefined` with a dev warning
rather than crashing. This is deliberate: `pnpm install && pnpm build && pnpm
lint && pnpm typecheck && pnpm test` must all pass on a fresh clone with **zero
credentials**.

**1.2 — A var becomes required only when a code path that needs it runs.**
`requireEnv(key)` throws a `MissingEnvError` naming the variable _and where to
get it_ ([web/src/env.ts:181](../apps/web/src/env.ts#L181)). `optionalEnv(key)`
is the non-throwing read.

**1.3 — Missing credentials degrade to a documented fallback, not an error.**
Each app ships `describeEnvStatus()` listing every service, whether it's
configured, and exactly what happens without it — surfaced in a dev-only
`<EnvStatus />` panel and a one-shot console warning.

⚠️ **The consequence to internalise:** in this codebase a missing secret does
not look like a failure. It looks like a _working app with a protection turned
off_. That is why the production boot gates in §4 exist.

---

## 2. Where env files actually live

**Next.js does not read the root `.env.local`.** Each app reads only its own.

| File                    | Read by                                             | Tracked? | Purpose                                             |
| ----------------------- | --------------------------------------------------- | -------- | --------------------------------------------------- |
| `.env.example` (root)   | nobody                                              | ✅       | Canonical reference of where every key comes from   |
| `apps/web/.env.local`   | `apps/web`                                          | ❌       | Live values for the customer app                    |
| `apps/agent/.env.local` | `apps/agent`                                        | ❌       | Live values for the agent PWA                       |
| `apps/admin/.env.local` | `apps/admin`                                        | ❌       | Live values for the ops console                     |
| `packages/db/.env`      | `drizzle-kit`, `migrate.ts`, `status.ts`, `seed.ts` | ❌       | **Points at the HOSTED project** — see §6           |
| `.env.test` (root)      | integration suites                                  | ❌       | **Generated** by `test-env.sh up`. Do not hand-edit |

Each app also has its own `apps/<app>/.env.example` — **those are the accurate
ones**. Copy them:

```bash
cp apps/web/.env.example   apps/web/.env.local
cp apps/agent/.env.example apps/agent/.env.local
cp apps/admin/.env.example apps/admin/.env.local
```

⚠️ **The root `.env.example` is a reference, not a working file.** Nothing
reads it — Next loads only `apps/<app>/.env.local` — so it drifts silently, and
has done twice. Refreshed against the three schemas on 2026-08-29; the per-app
examples and the `env.ts` files remain the source of truth. Keep the root
template for the connection-string shapes it documents inline (§6), not as a
checklist.

---

## 3. The full matrix

Legend: ● required for the feature to work · ○ optional/degrades · — not read.

| Variable                                 | web | agent | admin | Where to get it                                                                                                                                                                               |
| ---------------------------------------- | :-: | :---: | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                    |  ○  |   ○   |   ○   | Own origin. Dev: `:3000` / `:3001` / `:3002`                                                                                                                                                  |
| `NEXT_PUBLIC_AGENT_APP_URL`              |  ○  |   —   |   ●   | Agent app's origin. Invite links land there; web uses it for staff push deep links                                                                                                            |
| `NEXT_PUBLIC_ADMIN_APP_URL`              |  ○  |   —   |   —   | Admin console's origin. Read by [web/src/lib/inngest.ts](../apps/web/src/lib/inngest.ts) so a staff push can deep-link into the console                                                       |
| `NEXT_PUBLIC_LAUNCH_MODE`                |  ○  |   —   |   —   | `coming_soon` closes /login, /trips, /dashboard and refuses OTP sends. Unset or `live` = fully live (§6.6)                                                                                    |
| `DATABASE_URL`                           |  ●  |   ●   |   ●   | Supabase → Settings → Database → **Connection pooling, Transaction mode, port 6543**                                                                                                          |
| `DIRECT_DATABASE_URL`                    |  —  |   —   |   —   | **Not app env.** `packages/db/.env` only — a hosted DDL credential no app reads (§6)                                                                                                          |
| `NEXT_PUBLIC_SUPABASE_URL`               |  ●  |   ●   |   ●   | Supabase → Settings → API → Project URL                                                                                                                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          |  ●  |   ●   |   ●   | Supabase → Settings → API → anon public key                                                                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`              |  ●  | **—** |   ●   | Supabase → Settings → API → service_role. **Never in agent** (§5)                                                                                                                             |
| `AUTH_SCHEMA_AVAILABLE`                  |  ○  |   —   |   —   | `"false"` only for bare local Postgres with no GoTrue                                                                                                                                         |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`         |  ●  |   ●   |   ●   | Cloudflare → Turnstile → Site key (invisible mode). **Same key in all three apps per environment** — see §5.2                                                                                 |
| `OTP_LOG_HMAC_KEY`                       |  ●  |   —   |   —   | `openssl rand -hex 32`. **Min 32 chars**                                                                                                                                                      |
| `CRON_SECRET`                            |  ●  |   ○   |   ○   | Any random string. Protects `/api/jobs/*` (web) and `/api/observability/test-error` (all three). Absent ⇒ those routes refuse to run                                                          |
| `STRIPE_SECRET_KEY`                      |  ●  |   —   |   ○   | Stripe → Developers → API keys (admin needs it for refunds)                                                                                                                                   |
| `STRIPE_WEBHOOK_SECRET`                  |  ●  |   —   |   —   | Stripe → Webhooks, or `stripe listen` locally                                                                                                                                                 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`     |  ●  |   —   |   —   | Stripe → Developers → API keys                                                                                                                                                                |
| `INNGEST_EVENT_KEY`                      |  ○  |   ○   |   ○   | Inngest Cloud → Events. web serves the registry; agent and admin only SEND. Not needed for `pnpm dev:inngest`                                                                                 |
| `INNGEST_SIGNING_KEY`                    |  ○  |   —   |   —   | Inngest Cloud → Deploy → Signing key                                                                                                                                                          |
| `RESEND_API_KEY`                         |  ○  |   —   |   —   | Resend dashboard. **Required in production** (boot gate) — without it email degrades to console                                                                                               |
| `RESEND_FROM`                            |  ○  |   —   |   —   | RFC 5322 From. Defaults to Resend's sandbox sender; set to the verified domain for real sends                                                                                                 |
| `OPS_ALERT_EMAIL`                        |  ○  |   —   |   —   | Ops inbox for `booking/exception_raised` alert emails; unset → skipped                                                                                                                        |
| `AEROAPI_KEY`                            |  ○  |   —   |   —   | FlightAware AeroAPI. **Stubbed**                                                                                                                                                              |
| `GOOGLE_MAPS_SERVER_KEY`                 |  ○  |   —   |   —   | Google Cloud → Maps Platform. **Server** key, restricted to Routes API + Places API (New); application restriction = server, NEVER an HTTP referrer. Absent ⇒ haversine ETAs, no autocomplete |
| `ANTHROPIC_API_KEY`                      |  ○  |   —   |   —   | Ticket extraction. Absent → the free in-process heuristic extractor                                                                                                                           |
| `TICKET_EXTRACTION_DEBUG`                |  ○  |   —   |   —   | `1`/`true` returns the RAW extraction diagnostics to the browser. **Never set this on production** — the payload is a developer tool containing a customer's itinerary                        |
| `NEXT_PUBLIC_SENTRY_DSN`                 |  ○  |   ○   |   ○   | Sentry → Project → Client Keys. **One project per app, one DSN per environment.** Public by design; absent ⇒ the SDK initialises disabled                                                     |
| `SENTRY_ORG`                             |  ○  |   ○   |   ○   | **Build time only.** Shared org slug, for source-map upload                                                                                                                                   |
| `SENTRY_PROJECT`                         |  ○  |   ○   |   ○   | **Build time only.** This app's project slug                                                                                                                                                  |
| `SENTRY_AUTH_TOKEN`                      |  ○  |   ○   |   ○   | **Build time only, SECRET.** Scope `project:releases`. Absent ⇒ the upload is skipped and traces stay minified                                                                                |
| `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED` |  ○  |   ○   |   ○   | `"true"` arms Web Push. Anything else (including unset) = OFF: `ConsolePushSender`, every enable affordance hidden, the VAPID gate waived. §4.5                                               |
| `VAPID_PUBLIC_KEY`                       |  ○  |   ○   |   ○   | `pnpm push:vapid`. **All four VAPID vars or none** — see §4.5                                                                                                                                 |
| `VAPID_PRIVATE_KEY`                      |  ○  |   ○   |   ○   | Same command, same keypair. **Secret.** One keypair for all three apps                                                                                                                        |
| `VAPID_SUBJECT`                          |  ○  |   ○   |   ○   | A `mailto:` or `https:` URL identifying Koolee to the push service. Apple refuses a push without one                                                                                          |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`           |  ○  |   ○   |   ○   | **The same value as `VAPID_PUBLIC_KEY`**, exposed to the browser so it can subscribe. Absent ⇒ nothing can ever subscribe                                                                     |
| `ASSIGNMENT_HORIZON_HOURS`               |  ○  |   —   |   ○   | How far ahead auto-assign reaches. **Must MATCH across web and admin** or the console's badges disagree with the sweep ([core/src/config.ts](../packages/core/src/config.ts))                 |
| `TEST_DATABASE_URL`                      |  —  |   —   |   —   | Integration tests only. See [SCRIPTS.md](SCRIPTS.md)                                                                                                                                          |

Source of truth: [apps/web/src/env.ts](../apps/web/src/env.ts) ·
[apps/agent/src/env.ts](../apps/agent/src/env.ts) ·
[apps/admin/src/env.ts](../apps/admin/src/env.ts)

---

## 4. Fail-closed boot gates

Rule 1.1 says nothing throws. **These are the exceptions** — and each one exists
because a missing var silently disables a _security control_.

### 4.1 — `OTP_LOG_HMAC_KEY`, validated at import

Fires whenever `DATABASE_URL` is set, server-side only
([web/src/env.ts:204](../apps/web/src/env.ts#L204)). With a database configured
the OTP throttle **will** write `destination_hash` rows, so a missing or
under-32-char key must fail at env validation, not at the first OTP send. A
fresh clone with no `DATABASE_URL` still boots green.

### 4.2 — `assertProductionSecurityConfig()` — apps/web

Runs when `isProd && NEXT_PUBLIC_SUPABASE_URL` is set
([web/src/env.ts:241](../apps/web/src/env.ts#L241)). Refuses to boot if any of:

| Missing                          | Silently disables                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No widget mounts → `requireCaptchaToken` never demands a token → **CAPTCHA off across the whole funnel**                                                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`      | `deleteAuthUser` becomes a logged no-op → orphaned GoTrue users survive → reinstates the `phone_change` collision bug; **and** `signBagPhotoUrls` returns an empty map, so the trip page renders bags and custody events with no evidence photos |
| `DATABASE_URL`                   | `guardUpgradeSend` degrades to allow-all → **no OTP throttle, no reconciliation**, while Supabase still sends real SMS                                                                                                                           |
| `AUTH_SCHEMA_AVAILABLE="false"`  | Reconciliation explicitly skipped — a dev-only posture                                                                                                                                                                                           |

### 4.3 — `assertProductionBootConfig()` — agent & admin

Agent ([agent/src/env.ts](../apps/agent/src/env.ts)): refuses without Supabase
URL + anon key — staff sign-in _is_ that app, and without them every page
degrades to an unusable login screen.

Admin ([admin/src/env.ts](../apps/admin/src/env.ts)): also requires
`SUPABASE_SERVICE_ROLE_KEY` (staff invites and evidence-photo signed URLs become
no-ops) and `NEXT_PUBLIC_AGENT_APP_URL` (agent invite links would land on the
wrong app).

### 4.3b — `RESEND_API_KEY` in production — apps/web

Runs under the same conditions as 4.2 (prod + Supabase configured + not
coming-soon), plus the 4.4 build-phase exemption. Without the key the notifier
silently degrades to console — in production that means booking confirmations
vanish into a log nobody reads. Coming-soon deploys are exempt because no
booking can complete.

### 4.4 — Why builds still pass

`next build` runs with `NODE_ENV=production`. The agent and admin gates are
exempted via `process.env.NEXT_PHASE !== "phase-production-build"`, so a
credential-less fresh clone still builds. The gates fire when a production
**server** boots.

🧭 **A failed boot assertion is the intended outcome of a missing secret, not a
bug to work around.** Do not add a bypass flag.

### 4.5 — Web Push: all four VAPID vars, or none — all three apps

Fires only when `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true"`. With push
armed, a **partial** VAPID set (1–3 of the four) refuses the boot; zero is fine
and four is fine.

The asymmetry is the point. The fallback for "no VAPID keys" is
`ConsolePushSender`, which logs the payload and **reports success**. So a
half-configured deploy produces the worst possible state: every notification
looks sent, nothing arrives, and the did-you-see-it check built to detect that
is itself lying. Push is never load-bearing in Koolee — no state transition
waits on one — so this gate does not block the product. It blocks the _silent_
version of it.

Three consequences worth holding on to:

- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` carries the same value as
  `VAPID_PUBLIC_KEY`.** Not a mistake and not a duplicate: the browser needs
  the public key to call `pushManager.subscribe()`, and only `NEXT_PUBLIC_`
  vars reach it. Setting one without the other is the exact half-configured
  state above — the app holds a keypair the browser can never subscribe
  against.
- **One keypair serves all three apps.** Generate it once with
  `pnpm push:vapid` and paste the same four values into each `.env.local`.
  Rotating the keypair invalidates every stored subscription; the rows in
  `push_subscriptions` survive and go quietly dead.
- **Turning the flag off does not delete subscriptions.** OFF means a console
  sender, hidden enable affordances, and a waived gate — the stored rows are
  left alone and start delivering again when it is switched back on.

Source: [web/src/env.ts](../apps/web/src/env.ts) ·
[agent/src/env.ts](../apps/agent/src/env.ts) ·
[admin/src/env.ts](../apps/admin/src/env.ts). Rollout walkthrough:
[features/f3-hosted-setup.md](features/f3-hosted-setup.md).

---

## 4.5 Things that look like they need a variable and do not

**The map.** There is no map key, no map account and no map environment
variable, in any environment — the trip page draws MapLibre over OpenFreeMap.
If a map is blank, the variable is not what is missing: check that
`/maplibre/maplibre-gl-worker.mjs` is being served. It is copied into the app's
`public/` by `scripts/copy-maplibre-worker.mjs`, which runs inside `dev` and
`build`, and the failure without it is completely silent — style, TileJSON and
sprites all return 200 and no tile is ever requested. See
[SCRIPTS.md](SCRIPTS.md#copy-maplibre-workermjs-and-why-a-map-needs-a-build-step).

`GOOGLE_MAPS_SERVER_KEY` is for Places and Routes, both server-side, and must
never reach a client bundle. It has nothing to do with rendering.

## 5. Secrets that must NOT be in app env

**5.1 — Twilio / SMS credentials for auth OTP.** Owned entirely by Supabase Auth.
They live in the Supabase dashboard and never in any `.env`. The app calls
Supabase; Supabase calls Twilio.

**5.2 — The Turnstile _secret_ key.** Only the **site** key is app env. The
secret lives in Supabase dashboard → Auth → Attack Protection. Supabase verifies
the `captchaToken` the app forwards, so **this app never calls `siteverify`**.

Corollary, learned the hard way: **CAPTCHA protection is a Supabase PROJECT
setting, not a per-app one.** Enabling it for the customer funnel also gated
GoTrue's `/token?grant_type=password` and `/recover`, which are the staff apps'
sign-in and password-reset calls — both started failing with
`captcha protection: request disallowed (no captcha_token found)`. So agent and
admin now mount a Turnstile widget too and forward `captchaToken` the same way
web does. Because the secret is a single per-project value, all three apps must
use the **same site key** for a given environment; a different widget's token
fails siteverify.

**The hostname list is per-widget, and an entry covers only ITS OWN
subdomains.** An earlier revision of this section claimed the
`dev.koolee.cloud` entry "already covers the staff subdomains". It does not,
and the staff apps failed on it: `dev.admin.koolee.cloud` reads
`dev` · `admin` · `koolee.cloud`, so it is a subdomain of **`admin.koolee.cloud`**,
not of `dev.koolee.cloud`. The widget refused it with client-side error
**`110200` — unknown domain**, which the browser then follows with a
`postMessage` origin mismatch and a `400` on
`challenges.cloudflare.com/cdn-cgi/challenge-platform/…` — both downstream of
the refusal, not separate faults.

Every hostname that mounts the widget must be listed on the widget itself
(Cloudflare → Turnstile → the widget → Settings → Hostname Management):

| Environment | Widget hostnames                                                         |
| ----------- | ------------------------------------------------------------------------ |
| Production  | `koolee.cloud` · the prod agent host · the prod admin host               |
| Dev         | `dev.koolee.cloud` · `dev.agent.koolee.cloud` · `dev.admin.koolee.cloud` |

Adding the apex `koolee.cloud` to the DEV widget would cover all of them in one
entry and must not be done — it would let the dev widget answer for production.
`localhost` is accepted without an entry, which is why this reproduces only on
a hosted host and never on a laptop.

**5.3 — `SUPABASE_SERVICE_ROLE_KEY` in `apps/agent`.** Deliberately absent, and
this is a design decision, not an oversight: the agent app runs on a shared,
frequently-lost field device. It authenticates as the signed-in agent via the
anon key, and bag-photo uploads are authorized by **Storage RLS** — which is the
only authorization mechanism available there precisely _because_ there is no
service key ([agent/src/env.ts describeEnvStatus](../apps/agent/src/env.ts)).

---

## 6. `packages/db/.env` points at LOCAL — hosted only by explicit override

**Flipped 2026-08-22** (it used to point at hosted, and a bare command
silently migrating/seeding the hosted project is exactly the accident that
motivated the flip). `packages/db/.env` and `.env.example` now default both
URLs to the local Supabase stack (`127.0.0.1:54322`), so a **bare**
`pnpm db:migrate`, `pnpm db:status`, `pnpm seed`, or `pnpm db:studio` targets
**local**.

Targeting **hosted** now requires an inline override — shell env always wins:
`migrate.ts`, `status.ts`, and `drizzle.config.ts` each capture
`process.env.DIRECT_DATABASE_URL` / `DATABASE_URL` _before_ calling dotenv
([migrate.ts:15-21](../packages/db/src/migrate.ts#L15-L21)).

```bash
# Targets HOSTED — deliberate, visible, never the default.
DIRECT_DATABASE_URL='postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:migrate
```

**Both `migrate.ts` and `status.ts` print `Target host:` before doing anything.**
Read that line every time — it exists specifically so "migrations landed on the
wrong database" is visible rather than discovered later.

`pnpm seed:local` additionally pins both URLs at the local stack before
anything reads the environment, and is still the recommended one-command seed.

**Hosted migrations are normally not run by hand at all anymore:** merging
into `dev`/`main` applies them via GitHub Actions, each branch to its own
database, using the `DEV_DIRECT_DATABASE_URL` / `PROD_DIRECT_DATABASE_URL`
GitHub secrets (session-pooler URLs). See
[MIGRATIONS §9.5](MIGRATIONS.md#95-ci-migrations-apply-automatically-on-merge).

---

## 6.5 Two Supabase projects: prod vs dev (since 2026-08-23)

|                        | **prod**                                                          | **dev**                              |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| Project ref            | `dblfbpxorleurqdlkylz`                                            | `jpvlzoikcivxepgyrkho`               |
| Region                 | `us-east-2`                                                       | `ca-central-1` (historical accident) |
| Data API               | **disabled** (nothing uses `/rest/v1`; auth + storage unaffected) | enabled (legacy)                     |
| Vercel env scope       | **Production** (deploys of `main`)                                | **Preview** (every other branch)     |
| CI migration secret    | `PROD_DIRECT_DATABASE_URL`                                        | `DEV_DIRECT_DATABASE_URL`            |
| Test OTP phone numbers | **NEVER**                                                         | yes (`+13322602829` etc.)            |
| Stripe                 | live keys at launch (test until then)                             | test keys                            |

Rules that make the split hold:

- **Secrets are never shared across the pair** — prod has its own
  `OTP_LOG_HMAC_KEY`, `CRON_SECRET`, Turnstile widget, and Supabase keys.
- **Connection strings use the pooler host** with username
  `postgres.<ref>`: transaction mode `:6543` for app runtime
  (`DATABASE_URL`), session mode `:5432` for migrations. The
  `db.<ref>.supabase.co` host is IPv6-only — unreachable from GitHub
  runners and most home networks (§6, MIGRATIONS §9.5).
- **Nothing dev-flavored can leak into prod by construction**: the staff/
  customer seed hard-skips non-local Supabase hosts, agent zones seed only
  locally, and CI never seeds.
- Dashboard-owned config (Twilio creds, Turnstile secret, Site URL,
  redirect URLs) must be set **per project** — it does not travel with
  migrations.

## 6.6 The Vercel side of the split, and the dashboard config behind it (2026-08-23)

`apps/web` is ONE Vercel project. The branch decides which variable set a build
sees:

|                           | **Production scope**       | **Preview scope**                                                                                                               |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Branch                    | `main`                     | every other branch                                                                                                              |
| Domain                    | `koolee.cloud`             | `dev.koolee.cloud`, pinned to the `dev` branch (Vercel → Domains → Git Branch). Other branches get their own `*.vercel.app` URL |
| `NEXT_PUBLIC_LAUNCH_MODE` | `coming_soon` until launch | `live`                                                                                                                          |

Rejected alternatives: two Vercel projects, and Vercel Custom Environments.
Both duplicate configuration that Preview scope already provides, and §6.5's
"every non-`main` branch talks to the dev database" property falls out of
Preview scope for free.

Things that cost real debugging time to learn:

- **Vercel bakes env vars into a build** — server-side ones too, not just
  `NEXT_PUBLIC_*`. Changing a variable does nothing to deployments that already
  exist. Redeploy with the build cache **off**, or a cached client bundle keeps
  the old inlined value and the fix looks like it did not work.
- **Every variable naming an external service needs two rows**, one per scope,
  with different values. A single row ticked for both environments is how a dev
  deployment ends up writing to the production database. Shared read-only keys
  (`AEROAPI_KEY`, `RESEND_API_KEY`) are the exception. **Two keys left that
  list in Tier 5:** `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` — one shared DSN
  merges preview errors into the production project, which is the opposite of
  what an error tracker is for — and the Maps key, now
  `GOOGLE_MAPS_SERVER_KEY`, because it is metered and billed and dev traffic
  should not spend production's quota.
- **`NODE_ENV` is `production` in Preview too**, so every boot gate in §4 fires
  on `dev.koolee.cloud` exactly as it does in production. That is deliberate —
  dev rehearses prod. `VERCEL_ENV` is the only variable that distinguishes them.
- **Deployment Protection must be OFF for Preview.** With Vercel Authentication
  on, `/api/inngest` and `/api/webhooks/stripe` answer machine callers with a
  302 to `vercel.com/sso-api`, so Inngest cannot sync and Stripe cannot deliver.
  A browser session hides this, because the developer is already logged in.
  Consequence: `dev.koolee.cloud` is publicly reachable while running the live
  funnel. It is **not** `noindex` yet — see the TODO below.

### Supabase auth email (dev project, 2026-08-23)

Email OTP is dead in the water without all four of these, and none of them are
visible in the codebase:

1. **Custom SMTP** — Authentication → Notifications → Email. Resend:
   host `smtp.resend.com`, port `465`, username the literal string `resend`,
   password a Resend API key. The project was previously on Outlook SMTP, which
   silently failed: Microsoft has disabled basic SMTP auth for most tenants and
   would not send as `@koolee.cloud` anyway.
2. **`{{ .Token }}` in three templates** — _Confirm signup_ (new user via
   `signInWithOtp`), _Magic Link_ (existing user), _Change Email Address_
   (`updateUser({ email })`, which is the profile page's resend). A template
   holding only `{{ .ConfirmationURL }}` sends a LINK no matter what the app
   asked for, which reads as "the code never arrives".
3. **OTP length 6.** `verifyOtp` validates `/^\d{6}$/` and three strings say
   "6-digit code". The project defaulted to 8, so every code would have been
   rejected after delivery started working.
4. **Site URL** = `https://dev.koolee.cloud`, since `{{ .ConfirmationURL }}` is
   built from it.

### Inngest and Turnstile

- **Inngest app id is hardcoded `"koolee"`** (`packages/core/src/jobs/client.ts`)
  for every environment. Syncing a dev URL into the **Production** Inngest
  environment therefore does not create a second app — it repoints prod's app at
  dev, and prod's crons start running against the dev database. Separate
  per-environment signing keys are what make this safe: Inngest routes a sync by
  the key that authenticated it. Sync URL: `https://dev.koolee.cloud/api/inngest`.
- **Turnstile: two widgets**, one per environment. Each widget must list
  **every hostname that mounts it** — an entry covers that hostname and its
  OWN subdomains only, so `dev.admin.koolee.cloud` is NOT covered by
  `dev.koolee.cloud` (it sits under `admin.koolee.cloud`). That belief is what
  caused the `110200` outage; the full list and the reasoning are in §5.2, and
  this line used to contradict it. Never add the apex `koolee.cloud` to the
  dev widget — it would let dev answer for production. Ad-hoc
  `*.vercel.app` previews **cannot** pass the captcha: `vercel.app` is on the
  Public Suffix List, and the secret is a single per-Supabase-project value, so
  it cannot be varied per branch. Treat those URLs as UI review only and test
  anything auth- or booking-shaped on `dev.koolee.cloud`.

TODO(dev-env): `dev.koolee.cloud` needs `X-Robots-Tag: noindex` while it serves
the live funnel on a public URL. Gate it on `VERCEL_ENV === "preview"` — not
`!== "production"`, so a missing variable fails safe and cannot de-index the
real site.

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

| Symptom                                                                                                                            | Cause                                                                                                                                                                                                   | Fix                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App boots, feature silently absent                                                                                                 | Var missing, degraded to fallback                                                                                                                                                                       | Check the dev `<EnvStatus />` panel or the startup console warning                                                                                                                         |
| `MissingEnvError: Missing required environment variable X`                                                                         | A code path needed X                                                                                                                                                                                    | The error message names the dashboard page. Set it                                                                                                                                         |
| Production boot refuses with a list                                                                                                | §4 gate fired                                                                                                                                                                                           | Set the listed vars. **Do not bypass**                                                                                                                                                     |
| `prepared statement "s1" does not exist`                                                                                           | Pooled URL used for migrations                                                                                                                                                                          | Use `DIRECT_DATABASE_URL` (port 5432)                                                                                                                                                      |
| Migration hit the wrong database                                                                                                   | §6 — dotenv resolved to hosted                                                                                                                                                                          | Read the `Target host:` line; pin the URL inline                                                                                                                                           |
| Hostname did not resolve (`ENOTFOUND`)                                                                                             | Supabase direct connection is IPv6-only                                                                                                                                                                 | Use the **session pooler** on port 5432: `aws-0-<region>.pooler.supabase.com`                                                                                                              |
| `ERR_NAME_NOT_RESOLVED` on `db.<ref>.supabase.co/auth/v1/...`, app can't load, staff sign-in says "Email or password didn't match" | `NEXT_PUBLIC_SUPABASE_URL` was copied from **Database** settings. `db.<ref>` is the direct Postgres host — IPv6-only, no HTTP API — so every auth call dies and supabase-js reports it as an auth error | Settings → **API** → Project URL: `https://<ref>.supabase.co`, no `db.` prefix. Redeploy. Rejected at parse since 2026-08-30, so the app now degrades to "not configured" instead          |
| Var set but not visible in browser                                                                                                 | Not prefixed `NEXT_PUBLIC_`                                                                                                                                                                             | Only `NEXT_PUBLIC_*` is inlined into client bundles                                                                                                                                        |
| Staff sign-in says "Email or password didn't match" with a password that provably works                                            | GoTrue rejected the CAPTCHA, not the credentials — usually `NEXT_PUBLIC_TURNSTILE_SITE_KEY` missing on the SERVER, which makes the app's pre-flight guard inert and sends no token                      | Supabase → Logs → Auth. Look for `error_code: captcha_failed`. Set the site key in that deployment's scope and redeploy. The apps report this honestly since 2026-08-30 (`isCaptchaError`) |
| Root `.env.local` edited, nothing changed                                                                                          | Next reads only `apps/<app>/.env.local`                                                                                                                                                                 | Edit the per-app file                                                                                                                                                                      |
