# Runbook — standing up production

**What this is.** The ordered, deduplicated list for bringing a production
Koolee stack up from nothing: Supabase, Vercel, Inngest, Turnstile, Stripe,
Sentry, and the launch data. Compiled from five hosted-setup docs plus
`ENVIRONMENT.md`, `MIGRATIONS.md`, `payments.md`, `storage-and-avatars.md` and
`realtime-signals.md`, with the contradictions between them resolved.

**Who does what.** Every step is marked **[TD]** (a human, by hand) or **[CI]**
(automatic on merge). There is no step marked both.

**Order matters.** The dependencies are real: Vercel cannot build without env,
Inngest cannot sync without a deployed URL, and the console cannot enter launch
data without an admin account.

**Related runbooks:** [stripe-live-flip.md](stripe-live-flip.md) once business
verification clears, and [cutover-rehearsal.md](cutover-rehearsal.md) — the
scripted end-to-end pass to run when this list is finished.

---

## A. Database

| #   | Step                                                                                                                                                                                                                                                                                                | Who |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| A1  | Create the production Supabase project. Note the ref, the region, and both connection strings — **pooled 6543 for runtime, direct 5432 for migrations**. Never mix them: DDL through the transaction pooler gives `prepared statement does not exist` errors that do not reproduce locally.         | TD  |
| A2  | Add `PROD_DIRECT_DATABASE_URL` to the repo's GitHub Actions secrets (session pooler, **port 5432**, `postgres.<ref>@aws-0-<region>.pooler.supabase.com`).                                                                                                                                           | TD  |
| A3  | Merge to `main`. `.github/workflows/migrate.yml` applies every pending migration, then runs `db:status` and **fails red on hash drift**.                                                                                                                                                            | CI  |
| A4  | **Before that merge**, pre-check for 0025: `SELECT booking_id, count(*) FROM agreement_acceptances GROUP BY booking_id HAVING count(*) > 1` must return zero rows. On a brand-new project it trivially does.                                                                                        | TD  |
| A5  | 0029 **drops `drivers`, `routes`, `agents`** and `RAISE EXCEPTION`s if any has grown a row. A red CI migrate step here means investigate — never force.                                                                                                                                             | —   |
| A6  | Confirm from a shell: `DIRECT_DATABASE_URL='<prod direct>' pnpm db:status` → in sync, matched by **content hash**. Prose is not proof; this file has been wrong before.                                                                                                                             | TD  |
| A7  | Reference data, **brand-new project only**: `SEED_ALLOW_HOSTED=1 DATABASE_URL='<prod pooled>' pnpm seed`. The seed REFUSES a non-local host without that variable because it resets the 128 cutoff rows and rewrites the active pricing rule. On any project ops has touched, skip this and use §H. | TD  |
| A8  | Hosted carries one **orphan journal row** on purpose. Leave it alone.                                                                                                                                                                                                                               | —   |

⚠️ The migrate workflow runs **in parallel** with the Vercel deploy. A
non-backward-compatible migration must not ride that race — ship it on its own
merge.

### A9 — ⚠️ `0033` is that migration, and promoting it to `main` needs a decision

**Read [MIGRATIONS §9.5](../MIGRATIONS.md#the-ordering-caveat) before the merge
that carries `0033`.** It adds eight `pickup_*` columns to `bookings`,
backfills them, and then sets four of them `NOT NULL` — **the contract rides
the same migration as the expand**, so neither deploy order is clean:

| Order                                         | What breaks                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Migration lands first, old code still serving | old `createBooking` omits `pickup_line1` → **NOT NULL violation → new bookings fail** |
| Deploy lands first, migration not yet applied | new code reads and writes columns that do not exist yet                               |

The window is the length of the deploy, and only **booking creation** is
affected — existing bookings, the agent app and the console are untouched
either way.

**Two options. Pick one knowingly; do not discover it.**

- **A. Accept the window (the default, pre-launch).** With no traffic and no
  real customers, a few minutes in which a booking cannot be created costs
  nothing. Merge normally and let the workflow race the build. This is what
  the launch checklist assumes.
- **B. Sequence it by hand.** For a `main` that is already serving real
  bookings:
  1. Put `apps/web` into `NEXT_PUBLIC_LAUNCH_MODE=coming_soon` (or take the
     funnel down) so no booking can be created during the window;
  2. merge and let `migrate.yml` apply `0033` **on its own**, with no code
     change riding along;
  3. confirm `DIRECT_DATABASE_URL='<prod direct>' pnpm db:status` is in sync;
  4. deploy the code;
  5. flip the launch mode back and create one booking to prove the path.

**No migration was written to fix this and none should be.** `0033` is already
applied to local and to dev; splitting it now would change an applied
migration's content hash and put every database that has it into permanent
drift. The expand/contract discipline is the lesson — see the §6 note in
MIGRATIONS.md — and this runbook step is how the one migration that broke it
gets deployed safely.

---

## B. Storage buckets

All four are declared in code and converged by migration; there is nothing to
click. Verify, do not create:

| #   | Check                                                                                                                                                                                                                                                | Who |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| B1  | `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id` — `bag-photos` (5 MiB), `passport-photos` (10 MiB), `ticket-uploads` (12 MiB), `avatars` (3 MiB), and **`public = false` on every row**.                   | TD  |
| B2  | `select policyname, cmd, qual, with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars%'` — must match on the FIRST path segment.                                                                | TD  |
| B3  | Same query for `passport_photos%` — both policies must call `public.is_active_staff`, **not** an inline `EXISTS` against `staff_members`. That subquery runs as `authenticated`, which has no privilege on that table. Got wrong twice (0008, 0022). | TD  |
| B4  | **Dashboard → Storage → Settings**: the project-wide upload ceiling (50 MB default) has no SQL surface and must stay above every bucket limit. The one storage number not tracked in this repo.                                                      | TD  |

---

## C. Realtime

| #   | Step                                                                                                                                                                                                                                                                                                                                                                       | Who |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| C1  | 0030 sets `REPLICA IDENTITY FULL` and adds `public.booking_signals` to the `supabase_realtime` publication.                                                                                                                                                                                                                                                                | CI  |
| C2  | **Database → Replication**: confirm the publication exists and lists `booking_signals`. The migration's block is a no-op if `supabase_realtime` does not exist.                                                                                                                                                                                                            | TD  |
| C3  | Verify the GRANT: `select grantee, privilege_type from information_schema.role_table_grants where table_name='booking_signals' and privilege_type='SELECT'` → `authenticated`, and nobody else. **A missing grant is silently dead realtime** — an RLS policy grants nothing, it only narrows. 0031 exists for exactly this.                                               | TD  |
| C4  | Expect `relrowsecurity = t`, `relreplident = f`, exactly one policy (`booking_signals_select_watchable`), and **four** triggers on `custody_events`.                                                                                                                                                                                                                       | TD  |
| C5  | `0034` **removes** `custody_events` from the publication, so C2's list must show `booking_signals` and nothing else. Nothing subscribes to `custody_events` — the doorbell is `booking_signals`, and the client refetches through the ordinary server path. If it is ever re-added, **the GRANT must go with it** or the subscription is silently dead. See MIGRATIONS §6. | TD  |

---

## D. Supabase auth (dashboard only — travels with no migration)

| #   | Setting                                                                                                                                                                                                                                             | Who |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| D1  | **Custom SMTP** — Authentication → Notifications → Email. Resend: host `smtp.resend.com`, port `465`, username the literal `resend`, password a Resend API key.                                                                                     | TD  |
| D2  | **`{{ .Token }}` in three templates** — _Confirm signup_, _Magic Link_, _Change Email Address_. A template holding only `{{ .ConfirmationURL }}` sends a link, and the funnel asks for a code.                                                      | TD  |
| D3  | **OTP length = 6.** `verifyOtp` validates `/^\d{6}$/`; the project default is 8.                                                                                                                                                                    | TD  |
| D4  | **Site URL** = the production origin. `{{ .ConfirmationURL }}` is built from it.                                                                                                                                                                    | TD  |
| D5  | **Turnstile SECRET key** → Auth → Attack Protection. CAPTCHA is a PROJECT setting, so enabling it gates the staff apps' `signInWithPassword`/`recover` too — which is why all three apps mount a widget.                                            | TD  |
| D6  | **Anonymous sign-ins must stay ENABLED.** The funnel starts with `signInAnonymously()`.                                                                                                                                                             | TD  |
| D7  | **Twilio Verify credentials** live only in the dashboard, never in app env. Blocked on A2P — see the checklist.                                                                                                                                     | TD  |
| D8  | **No test phone numbers** in the prod dashboard, and `[auth.sms.test_otp]` from `supabase/config.toml` must not reach the prod project. **Two independent sources; check both.** `13322602829` is valid-format and passes the app's own validation. | TD  |

---

## E. Turnstile (Cloudflare)

| #   | Step                                                                                                                                                                                                           | Who |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| E1  | Two widgets, one per environment. The prod widget's hostname list must contain **the apex, the prod agent host AND the prod admin host**, each listed explicitly.                                              | TD  |
| E2  | **An entry covers that hostname and its OWN subdomains only.** `dev.admin.koolee.cloud` sits under `admin.koolee.cloud`, not under `dev.koolee.cloud`. Believing otherwise is what caused the `110200` outage. | —   |
| E3  | **Never** add the apex to the dev widget — it would let dev answer for production.                                                                                                                             | —   |
| E4  | All three apps use the **same site key** per environment; the secret is one per-Supabase-project value.                                                                                                        | TD  |
| E5  | `*.vercel.app` previews **cannot** pass the captcha (`vercel.app` is on the Public Suffix List). Test anything auth-shaped on the real preview host.                                                           | —   |

---

## F. Vercel

| #   | Step                                                                                                                                                                                        | Who |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| F1  | One project per app. `main` → Production scope + the prod domain; every other branch → Preview scope.                                                                                       | TD  |
| F2  | **Env vars bake at build time**, server-side ones included. Changing one does nothing to an existing deployment: redeploy with the **build cache off**.                                     | —   |
| F3  | **Every variable naming an external service needs two rows**, one per scope, with different values. A single row ticked for both is how a dev deployment writes to the production database. | TD  |
| F4  | `NODE_ENV` is `production` in Preview too, so every boot gate fires there. That is deliberate — dev rehearses prod.                                                                         | —   |
| F5  | **Deployment Protection OFF for Preview**, or `/api/inngest` and `/api/webhooks/stripe` answer machine callers with a 302 to `vercel.com/sso-api`. A browser session hides this.            | TD  |
| F6  | Set the variables: `pnpm env:verify --app <app>` against the scope, then fill every MISSING line. See §G.                                                                                   | TD  |

---

## G. The env pass

The manifest at [`scripts/env-manifest.json`](../../scripts/env-manifest.json)
is the checklist — names and reasons, never values, derived from the boot gates
in `apps/*/src/env.ts`.

```bash
# What Production is missing today (launch-mode gates waived, as prod runs them)
vercel env ls production | pnpm env:verify --stdin

# What it will be missing the moment NEXT_PUBLIC_LAUNCH_MODE flips to live.
# RUN THIS BEFORE THE FLIP — it arms five apps/web gates at once.
vercel env ls production | pnpm env:verify --stdin --live

# And if push is being turned on in the same deploy:
vercel env ls production | pnpm env:verify --stdin --live --push
```

It reads names, so it proves a row EXISTS for that scope. Whether the row holds
the RIGHT value is a question only a deploy can answer — which is why §I exists.

It also fails on a **forbidden** variable: `apps/agent` must never carry
`SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY`. A compromised agent device
must not reach a credential that bypasses every policy.

---

## H. Inngest

| #   | Step                                                                                                                                                                                                                                          | Who |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| H1  | The app id is **hardcoded `"koolee"`** for every environment. Syncing a dev URL into the **Production** Inngest environment does not create a second app — it repoints prod's app at dev, and prod's crons then run against the dev database. | —   |
| H2  | Separate **per-environment signing keys** are what make H1 safe: Inngest routes a sync by the key that authenticated it.                                                                                                                      | TD  |
| H3  | Sync `https://<prod origin>/api/inngest` into the **Production** Inngest environment, with the **prod** signing key. Only `apps/web` serves that route; agent and admin are send-only.                                                        | TD  |
| H4  | `INNGEST_SIGNING_KEY` on `apps/web` only; `INNGEST_EVENT_KEY` on all three.                                                                                                                                                                   | TD  |
| H5  | Confirm **16 functions and 4 crons** are visible. Three crons are `*/5`; one is `TZ=America/New_York 0 10 * * *` and one `0 4 * * *`.                                                                                                         | TD  |

---

## I. Sentry

| #   | Step                                                                                                                                                                                                                                                          | Who |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| I1  | **Three projects, one per app.** One shared DSN would merge preview errors into the production project, which is the opposite of what an error tracker is for.                                                                                                | TD  |
| I2  | Per app, per scope: `NEXT_PUBLIC_SENTRY_DSN` (that app's own DSN — public by design), `SENTRY_PROJECT` (that app's slug), and the shared `SENTRY_ORG` and `SENTRY_AUTH_TOKEN` (**sensitive**).                                                                | TD  |
| I3  | After the first deploy, per app: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<origin>/api/observability/test-error`. The reply names the `environment` and `release` to expect; confirm the event lands in **that app's** project with those tags. | TD  |
| I4  | Browser half: open the app, devtools console, `!!window.__SENTRY__` → `true`. That proves the client SDK initialised with the deployed DSN.                                                                                                                   | TD  |
| I5  | Confirm source maps uploaded — an event's stack should name real files, not `chunk-abc.js`. If not, `SENTRY_AUTH_TOKEN` was absent at build time.                                                                                                             | TD  |

### Sentry ON A LAPTOP — you do not have to deploy to find out

The wiring is not deploy-only. `sentryOptions` sets `enabled: Boolean(dsn)`, so
a DSN in `.env.local` sends real events from `pnpm dev`, tagged
`environment: "development"` and with no release. Nothing else has to change.

```bash
# 1. apps/<app>/.env.local — the same DSN the deployed app uses is fine;
#    "development" is what keeps local noise out of your production filters.
NEXT_PUBLIC_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>

# 2. Restart the dev server. Sentry initialises at boot; a DSN added to a
#    running server does nothing, which is the usual reason this "doesn't work".

# 3. Prove it. No CRON_SECRET needed locally.
curl -X POST http://localhost:3000/api/observability/test-error
```

The reply tells you which of the two things happened:

- `"sent": true` — the event left the process. Search Sentry for the `stamp`
  it printed, filtered to `environment:development`.
- `"sent": false` — the DSN is unset, so the SDK is disabled and the event was
  dropped. An `eventId` still comes back (the SDK mints one regardless), which
  is why `sent` is the field to read and not the id.

For the BROWSER half, open the app and check `!!window.__SENTRY__` in the
console, or throw from any client component — the client SDK reads the same
`NEXT_PUBLIC_SENTRY_DSN` at boot.

Two things stay deploy-only, and neither affects whether events arrive:
**source maps** (uploaded only when `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` are all
present, so a local stack names bundled files) and **`release`** (read from
`VERCEL_GIT_COMMIT_SHA`, absent on a laptop).

---

## J. Launch data (the console, not the seed)

**The seed is not the path.** It resets the cutoff matrix to 45/60 and rewrites
the active pricing rule, so it refuses a hosted database — see A7.

| #   | Step                                                                                                                                                                                                                                         | Where   | Who |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| J1  | Bootstrap the FIRST admin: `pnpm --filter @koolee/db bootstrap:staff` with `BOOTSTRAP_EMAIL`/`BOOTSTRAP_PASSWORD`. The seed's roster refuses non-local hosts, and `/staff` invites need an admin session to reach — this is the only way in. | shell   | TD  |
| J2  | **Airline cutoffs** — `/cutoffs`. The page says how many of the 128 rows are still the seed's placeholder; that number must reach **zero for every airline you sell**. Every sellable window is derived from these.                          | console | TD  |
| J3  | **Pricing** — `/pricing`. Publish the launch rule. The public pricing page reads the same active rule.                                                                                                                                       | console | TD  |
| J4  | **Agreement v2** — `/agreements`. Body prepared at [docs/launch/agreement-v2-draft.md](../launch/agreement-v2-draft.md), **after legal review**.                                                                                             | console | TD  |
| J5  | **Fleet** — `/trucks`. Enter the real vans and take both `DEV Truck …` fixtures out of service.                                                                                                                                              | console | TD  |
| J6  | **Staff** — `/staff`. Invite the agents and admins.                                                                                                                                                                                          | console | TD  |
| J7  | **`can_drive`** — `/shifts` → "Who may drive". Defaults **false**; until it is granted there is no shift, no driver shortlist, and every sealed booking reads "needs a driver".                                                              | console | TD  |
| J8  | **Zones** — `/zones`. Populate `agent_zones` for prod staff; the seed's round-robin runs only inside its local-only block.                                                                                                                   | console | TD  |
| J9  | **Coverage ZIPs** — `packages/db/src/coverage-zips.ts`. **Code, not a row, on purpose**: coverage decides where Koolee sells and belongs in review. Changing it is a PR and a deploy.                                                        | repo    | TD  |

⚠️ J9's header carries an unclosed obligation: _re-verify each coverage area
against the drive-time assumptions the cutoff maths relies on — an out-of-area
booking that gets sold is a booking that misses its flight._

---

## K. Going live

| #   | Step                                                                                                                                                                                                                                                                                                  | Who |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| K1  | `vercel env ls production \| pnpm env:verify --stdin --live` → clean. **Do this before K2**, not after.                                                                                                                                                                                               | TD  |
| K2  | Flip `NEXT_PUBLIC_LAUNCH_MODE` to `live` and redeploy with the cache off. This **arms five `apps/web` gates in one deploy** — Turnstile site key, service-role key, Resend, ops email, Anthropic — plus the four money gates Tier 5 added. A missing one refuses the boot, which is the gate working. | TD  |
| K3  | [stripe-live-flip.md](stripe-live-flip.md), when business verification has cleared. Until then the site runs live with **test** Stripe keys, which is a deliberate state: everything works and no real card is charged.                                                                               | TD  |
| K4  | [cutover-rehearsal.md](cutover-rehearsal.md), end to end, on prod infrastructure with a test card.                                                                                                                                                                                                    | TD  |
| K5  | `X-Robots-Tag: noindex` on the preview host while it serves the live funnel publicly. Gate it on `VERCEL_ENV === "preview"` — not `!== "production"`, so a missing variable fails safe. **Still open.**                                                                                               | TD  |
