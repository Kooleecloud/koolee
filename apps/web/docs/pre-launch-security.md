# Pre-launch security — hardening items

Auth is closed out (schema, throttle, reconciliation, role seam, and
acceptance tests 15/16 all in place and green). The items below were
identified during that work and initially deferred.

**Status (2026-08-09):** items **1, 2, 3, 4, and 7 are implemented** on
`feat/auth-close-out-parts-def` — each section below carries a `Resolved`
line saying where. Their analyses are kept because they explain WHY the code
is shaped the way it is. Items **5, 6, and 8 remain open**: they are
launch-day dashboard/config/deploy verifications, not code, tracked as
#24/#25/#43 in [PROJECT-STATUS.md](../../../PROJECT-STATUS.md).

## 1. Per-user throttle window is soft under concurrency (SMS-pumping vector)

> **Resolved 2026-08-09** — `acquireOtpSendLocks`
> (`packages/core/src/auth/otp-throttle.ts`) takes the user lock, then the
> destination lock, in that fixed order. Concurrency acceptance:
> `otp-throttle.integration.test.ts` (burst to distinct destinations holds
> the per-user cap).

`recordOtpSend` (`packages/core/src/auth/otp-throttle.ts`) takes its advisory
lock keyed on the **destination hash only**:

```ts
await tx.execute(
  sql`select pg_advisory_xact_lock(hashtextextended(${destinationHash}, 0))`,
);
```

Two concurrent sends for **different** destinations from the **same** user
never contend for the same lock, so their count checks can interleave and
both pass the per-user cap (`OTP_MAX_SENDS_PER_USER = 3` / 15 min) before
either row is visible. The per-destination cap still holds (each number is
individually throttled), but the per-user cap — the one meant to stop a
single anonymous session from being used to pump OTP sends at scale — goes
soft under a burst across many different numbers.

**Fix:** take a second advisory lock on `userId`, in **fixed order** (user,
then destination) so this can't deadlock against a concurrent request that
locks the same pair in the opposite order:

```ts
await tx.execute(
  sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}::text, 0))`,
);
await tx.execute(
  sql`select pg_advisory_xact_lock(hashtextextended(${destinationHash}, 0))`,
);
```

`reconcile-claims.ts` locks only on the destination hash and would be
unaffected — it never needs the user lock, since it reads by identifier, not
by user.

## 2. Reconcile runs after the throttle transaction commits, releasing the lock in between

> **Resolved 2026-08-09** — `guardUpgradeOtpSend`
> (`packages/core/src/auth/upgrade-guard.ts`) runs throttle + reconciliation
> as ONE transaction under one lock scope; `guardUpgradeSend` in
> `apps/web/src/actions/auth.ts` now makes a single core call. Overlap test
> in `upgrade-guard.integration.test.ts` ("merged guard"). Residual, by
> design: the Supabase send itself stays outside the lock, so a claimant that
> passed its guard but has not verified can still be reconciled away by a
> later guarded send — that is the last-claimant-wins behavior test 15 pins,
> not a race.

`guardUpgradeSend` (`apps/web/src/actions/auth.ts`) calls `recordOtpSend` and
`reconcilePhoneClaims`/`reconcileEmailClaims` as two **separate**
transactions, sequentially:

```ts
const allowance = await recordOtpSend(core.db, {...});   // tx #1: commits, releases the lock
if (!allowance.allowed) return { ok: false, code: "rate_limited", ... };

const reconciled = await reconcilePhoneClaims(core.db, ..., {...}); // tx #2: re-acquires the lock
```

Between those two transactions the advisory lock on the destination hash is
fully released, and `reconcileClaims` deletes _every_ anonymous row that
currently holds the destination — there's no ordering by recency, so either
side of a race can be the one deleted. Two concurrent anonymous sessions (A
and B) claiming the same new number can interleave across that gap:

1. A's `recordOtpSend` commits and releases the lock.
2. B's `recordOtpSend` commits and releases the lock.
3. A's reconcile runs, finds nothing yet (B hasn't called `updateUser` yet),
   returns `conflict: false`.
4. A calls `updateUser({ phone: P })` — GoTrue sends A's SMS and writes A's
   `phone_change`.
5. B's reconcile now runs. It sees A's row (anonymous, `phone_change = P`)
   and deletes A — draft, `public.users` row, and auth user — exactly as
   designed for an _abandoned_ claimant. But A's claimant isn't abandoned:
   A's SMS is already in flight, possibly already delivered.
6. B calls `updateUser({ phone: P })` and eventually verifies successfully.
   A, holding a code for a phone number attached to a now-deleted account,
   cannot complete verification and has lost its draft.

This is narrower than what collision test 15 covers (that test drives one
session's guarded sequence — throttle, reconcile, attach, verify — fully to
completion before starting the second session, which is exactly the
non-overlapping case the fix is supposed to guarantee). This item is about
the gap **between** `recordOtpSend`'s commit and `reconcileClaims`'s lock
re-acquisition, which only shows up when two sessions' guarded sequences
genuinely overlap in time — the current tests don't exercise that overlap.

**Fix:** merge `recordOtpSend` and `reconcileClaims` into one transaction
(same connection, same advisory lock scope, held for the duration of both),
or have `reconcileClaims` re-verify no new colliding claim appeared between
its own lock acquisition and the delete. The two functions already share a
lock key (the destination hash) specifically so they serialize against each
other — they just don't currently serialize against _themselves_ end-to-end
because they're not one transaction.

## 3. `assertProductionSecurityConfig()`

> **Resolved 2026-08-09** — implemented in `apps/web/src/env.ts`, run at
> import on any production server boot with Supabase configured. Demands the
> Turnstile site key, service-role key, DATABASE_URL, and an available auth
> schema (item 4's flag), listing everything missing in one error. Covered in
> `apps/web/src/env.test.ts`.

One boot-time assertion, thrown when the app is running in production (this
repo's existing convention is `env.isProd`, i.e. `NODE_ENV === "production"`
in `apps/web/src/env.ts` — use that rather than introducing `VERCEL_ENV`) and
any of:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` missing
- `SUPABASE_SERVICE_ROLE_KEY` missing
- `auth.users` unreadable (the same probe `isMissingAuthSchema` already
  does — see item 4)

Collapses three current fail-open branches into one fail-closed check:

- a missing Turnstile site key silently disables CAPTCHA across the whole
  funnel (`requireCaptchaToken` only enforces a token when the site key is
  configured — see `apps/web/src/actions/auth.ts`);
- a missing service-role key silently turns off orphan auth-user deletion
  (`getSupabaseAdminClient` in `apps/web/src/lib/supabase/admin.ts` degrades
  to a no-op) and reinstates the very collision bug tests 15/16 close out —
  reconciliation deletes the `public.users` row and drafts but never the
  orphaned Supabase auth user;
- the 42P01 catch (item 4) infers "not Supabase" from a Postgres error code
  and would misfire if Supabase ever changes the Drizzle role's `auth`
  schema grants, silently disabling reconciliation instead of failing loud.

## 4. Replace the 42P01 inference with an explicit flag

> **Resolved 2026-08-09** — `AUTH_SCHEMA_AVAILABLE` is now an app env var
> (`apps/web/src/env.ts`, exported as `authSchemaAvailable`; unset = available,
> fail-loud). `guardUpgradeSend` passes it as the guard's `reconcile` input;
> `isMissingAuthSchema` and the 42P01 catch are gone — unknown guard errors
> fail closed to `provider_error`.

`isMissingAuthSchema` in `apps/web/src/actions/auth.ts` infers "this is a
bare local Postgres with no GoTrue `auth` schema" from Postgres error code
`42P01` (undefined_table) on the `auth.users` query inside
`reconcileClaims`. That inference is exactly what it sounds like — a guess
from an error code, not a declared fact.

Note this is a **different** flag from the one added for tests 15/16:
`AUTH_SCHEMA_AVAILABLE` today only gates the integration test suite
(`packages/core/src/auth/upgrade-guard.integration.test.ts` and
`scripts/test-env.sh`) — it is not read anywhere in `apps/web` runtime code.
This item is about giving the **application** the same explicit signal,
instead of leaving `isMissingAuthSchema`'s error-code sniffing as the only
mechanism in the request path.

**Fix:** thread a real `AUTH_SCHEMA_AVAILABLE` (or similarly named) app env
var through `apps/web/src/env.ts`, and have `guardUpgradeSend` branch on it
directly instead of catching 42P01.

## 5. Turnstile Managed-mode check

Confirm the Turnstile widget on the flight-review page (where
`signInAnonymously` first fires) never renders an interactive challenge —
only ever the invisible/managed pass-through. An interactive checkbox at the
funnel's very first mutation is the one place in the flow where friction is
unacceptable; everywhere downstream the user has already committed. Verify
against the live Turnstile widget config in the Cloudflare dashboard, not
just the site key type.

## 6. Delete Supabase test phone numbers before launch (or split projects)

`supabase/config.toml`'s `[auth.sms.test_otp]` block —

```toml
15555550100 = "123456"
15555550101 = "654321"
15555550102 = "111111"
```

— plus `15555550103` and, since 2026-08-09, the **valid-format**
`13322602829` (added for manual UI testing: the app's libphonenumber
validation rejects the fictional 555 numbers at the form, so only a
real-format number can exercise the phone gate; it mirrors the hosted
project's dashboard test phone) — is what makes local dev and CI possible
without a real Twilio spend, and
is exactly what acceptance tests 15/16
(`packages/core/src/auth/upgrade-guard.integration.test.ts`) depend on. It is
also, by construction, **a permanent auth bypass**: anyone who knows one of
these five numbers and its fixed code can complete phone verification with
no SMS ever sent. `test_otp` is project-level config, not environment-level —
if the same Supabase project is ever used for both local/CI and production,
this ships as a live bypass.

**Before launch:** either confirm production runs a **separate** Supabase
project from local/CI (so `config.toml`'s `test_otp` block never applies to
it), or explicitly strip `[auth.sms.test_otp]` from whatever config reaches
the production project. Do not treat "we didn't set it in the dashboard" as
sufficient — verify it, because `supabase db push` / dashboard config drift
is exactly the kind of thing that silently reintroduces it.

The valid-format `13322602829` deserves special attention: unlike the
fictional 555 numbers, it passes the app's libphonenumber form validation, so
it is a **stronger** bypass — it can be typed into the production UI like any
real number. It also exists in **two places**: the `[auth.sms.test_otp]`
block in `supabase/config.toml` and the hosted project's dashboard-entered
test phone (they mirror each other). The launch check must cover both:
production must be a separate Supabase project, and both the config-file
block and any dashboard-entered test phone must be verified absent from it.

## 7. Narrow acceptance grep 11 to `TWILIO_|from ['"]twilio`

> **Resolved 2026-08-09** — [setup-auth.md](setup-auth.md) now carries the
> narrowed pattern.

`apps/web/docs/setup-auth.md`'s acceptance check —

```bash
grep -ri "twilio" apps/ packages/ --include='*.ts' --include='*.tsx'
```

— currently trips on its own intentional documentation: the provider-
ownership comment in `apps/web/src/actions/auth.ts` ("OTP delivery is owned
by Supabase Auth, not by us... Do not import the Twilio SDK here") contains
the word "Twilio" and is a legitimate, mandated comment, not a violation.
Narrow the pattern to catch actual env vars and imports —

```bash
grep -riE "TWILIO_|from ['\"]twilio" apps/ packages/ --include='*.ts' --include='*.tsx'
```

— so the check stops flagging the comment it should be encouraging.

## 8. Apply migration `0012_yummy_micromacro` to the hosted project

Virtual pickup windows shipped with migration `0012`: it adds
`bookings.pickup_window_start` / `pickup_window_end` / `price_breakdown`,
`pricing_rules.lead_time_multipliers`, the `slot_blocks` table, and a
backfill copying each legacy `slots` row's window onto its booking. It has
been applied to the **LOCAL stack only**. Until it reaches the hosted
project the funnel is broken from the window step onward —
`listBookableWindows` reads `slot_blocks` and `lead_time_multipliers`, and
`createBooking` inserts the window columns.

Not a code item: nothing in the repo can detect the hosted schema, so this
has to be run and verified by hand before deploy.

**Two traps, both about which database the command actually hits:**

- `packages/db/.env` points `DATABASE_URL` / `DIRECT_DATABASE_URL` at the
  **hosted** project, so a bare `pnpm db:migrate` targets hosted and a bare
  `pnpm seed` writes to hosted — the opposite of the usual expectation. Use
  `pnpm seed:local` (it pins both URLs to 127.0.0.1:54322 before anything
  reads the environment) or an explicit `DATABASE_URL` for anything meant
  to stay local.
- Migrating alone is not enough. `lead_time_multipliers` defaults to `'[]'`,
  which prices **every** window at ×1 — no error, just silently flat
  pricing. `pnpm seed` backfills the launch curve (≤10 h ×1.4, ≤16 h ×1.2,
  ≤24 h ×1.1) onto an existing pre-cutover rule row; confirm the hosted
  `pricing_rules` row carries it afterwards.
