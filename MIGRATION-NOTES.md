# Koolee — Dependency Migration Notes

## Summary (read this first)

**All 10 phases completed; every gate green.** Full detail per phase below.

- **Phases completed:** 0–10. None reverted, none held.
- **Blocked item (environment, not upgrade):** Phase 7's live-DB verification
  tier (seed + booking-transaction integration tests + custody trigger) needs
  local Postgres and this machine has no container runtime. One-command runbook
  in the Phase 7 section — run it once Docker is available.
- **Committing:** run `bash ../koolee-migration/commit-migration-phases.sh` —
  it turns the staged working tree into 10 atomic, individually-revertable
  commits (phases 1–10; phase 0 is already on the branch as `fcd87df`) on
  `chore/dependency-migrations` without touching the working tree (index-only
  replay of point-in-time patches, dry-run verified to reproduce this exact
  tree). Then open the PR manually as planned.

### Behavioral changes to watch in review

1. Production builds now use **Turbopack** (Next 16 default) — different
   chunking vs webpack; no per-route size table in build output.
2. **Middleware → proxy**: web's auth gate now runs on the **nodejs** runtime
   (was edge). Verified working; revisit if you deploy to an edge-only target.
3. **Stripe API pin jumped acacia → dahlia** (2024-12-18 → 2026-07-29). Our
   call surface is unchanged per SDK changelogs and a live test-mode
   round-trip passed, but skim Stripe's API changelog before launch.
4. **drizzle ≥0.44 wraps driver errors** (`DrizzleQueryError`); any future
   code inspecting pg error codes must walk `.cause` (one existing site fixed).
5. Tailwind v4 kept v3 semantics deliberately (hover-on-touch, border color,
   button cursor, placeholder color) via `packages/ui/styles/theme.css` —
   remove those blocks when you're ready to adopt v4 defaults.
6. Inngest senders should use the exported `eventType` objects
   (`bookingConfirmed.create(...)`) for typed sends.
7. ESLint 10 found and we fixed a real bug: a rethrow dropping its cause in
   `customers.ts`; the unused `eslint-plugin-react` dependency was removed.

Working branch: `chore/dependency-migrations` (from `dev` @ `27bb0e6`).
One phase = one atomic commit on this branch. Commits are run by Tarun
(Claude Code is not permitted to run `git commit` in this workspace — see
`commit-phases.sh` for the same convention on the original scaffold).

## Phase 0 — Preflight

### Environment

| Item | Declared | Actual at baseline |
|---|---|---|
| Node | `.nvmrc` 22, `engines >=22` | **v24.15.0** (machine default; satisfies engines — noted as deviation, aligned in Phase 8) |
| pnpm | `packageManager pnpm@11.18.0` | 11.18.0 |
| turbo tasks | — | `build`, `dev`, `lint`, `typecheck`, `test`, `clean`, `db:generate`, `db:migrate` (names match the plan; no adaptation needed) |

### Before table (installed versions from lockfile)

| Package | Where | Declared range | Installed | Target |
|---|---|---|---|---|
| tailwindcss | 3 apps + ui | ^3.4.17 | 3.4.19 | 4.x |
| tailwind-merge | ui | ^2.6.0 | 2.6.1 | 3.x |
| tailwindcss-animate | ui | ^1.0.7 | 1.0.7 | replace with tw-animate-css |
| autoprefixer | 3 apps | ^10.4.20 | 10.5.4 | remove (v4 handles prefixing) |
| stripe | core | ^17.5.0 | 17.7.0 | 22.x |
| @stripe/stripe-js | web | ^5.5.0 | 5.10.0 | 9.x |
| @stripe/react-stripe-js | web | ^3.1.1 | 3.10.0 | 6.x |
| inngest | core, web | ^3.29.3 | 3.54.2 | 4.x |
| next | 3 apps | ^15.1.6 | 15.5.22 | 16.x |
| @next/eslint-plugin-next | config | ^15.1.6 | 15.5.22 | 16.x |
| zod | core + 3 apps | ^3.24.1 | 3.25.76 | 4.x |
| eslint | everywhere | ^9.18.0 | 9.39.5 | 10.x |
| @eslint/js | config | ^9.18.0 | 9.39.5 | 10.x |
| globals | config | ^15.14.0 | 15.15.0 | 17.x |
| eslint-plugin-react-hooks | config | ^5.1.0 | 5.2.0 | 7.x |
| drizzle-orm | core, db | ^0.38.4 | 0.38.4 | 0.45.x |
| drizzle-kit | db | ^0.30.2 | 0.30.6 | 0.31.x |
| lucide-react | 3 apps + ui | ^0.474.0 | 0.474.0 | 1.x |
| sonner | ui | ^1.7.2 | 1.7.4 | 2.x |
| dotenv | db | ^16.4.7 | 16.6.1 | 17.x |
| vitest | core | ^2.1.8 | 2.1.9 | 4.x |
| turbo | root | ^2.3.3 | 2.10.7 | 2.10.8 (also tighten range) |
| @types/node | everywhere | ^22.10.7 | 22.20.1 | ^24 (Phase 8) |

Out of scope (unchanged by design): react/react-dom 19, @supabase/*, gsap,
motion, @radix-ui/*, date-fns, typescript 5.x (5.9 line), postgres driver,
prettier, typescript-eslint, Postgres docker image.

### Baseline gate — GREEN (2026-08-01, Node v24.15.0)

- `pnpm install --frozen-lockfile` — lockfile up to date, no warnings.
- `pnpm turbo build lint typecheck test --force` — **16/16 tasks successful, uncached** (17.0s).
- Core vitest suite: **142 passed, 10 skipped** (5 files passed, 1 file skipped —
  integration tests). These skip counts are the reference for later phases.
- Runtime smoke: all three apps serve HTTP 200 with real HTML and zero
  "Application error" / "Internal Server Error" strings
  (web 294 KB "Koolee — Fly Hassle-Free", agent 53 KB "Koolee Agent",
  admin 54 KB "Koolee Ops"). No errors or hydration warnings in dev-server logs.

### Deviations / incidents

- `git commit` is deny-listed for Claude Code in this workspace, so phases are
  recorded as sequential point-in-time patches and replayed as atomic commits
  via `commit-migration-phases.sh` (run once at the end by Tarun). "Phase
  committed" below means "gate green + patch captured".

- Baseline ran under **Node v24.15.0** (machine default) although `.nvmrc` says 22.
  `engines: >=22` is satisfied. Phase 8 aligns declared versions with 24.
- A `turbo dev` session (all 3 apps) was already running when preflight started.
  The baseline production build wrote into the same `.next/` directories and broke
  those live servers (all returned 500). The session was stopped (processes killed
  cleanly), fresh dev servers were used for the smoke test above, then shut down.
  **Restart your dev session after the migration** — and expect the same clash if
  `turbo dev` runs while any phase's gate builds are executing.

## Phase 1 — Tailwind CSS 3 → 4 (+ tailwind-merge 2 → 3) — DONE, gate GREEN

Versions: tailwindcss 3.4.19 → ^4.3.3 (apps; removed from packages/ui),
`@tailwindcss/postcss` ^4.3.3 added, autoprefixer removed (v4 handles it),
tailwind-merge 2.6.1 → ^3.6.0, tailwindcss-animate 1.0.7 → tw-animate-css ^1.4.0.

Structural changes:
- `packages/ui/tailwind-preset.js` + `theme-tokens.js` + `tailwind-preset.d.ts`
  **deleted**, replaced by CSS-first `packages/ui/styles/theme.css` (`@theme`
  brand scales, `@theme inline` semantic hsl-var tokens/radius/fonts,
  `@utility container`, accordion keyframes, base layer). Export map updated
  (`@koolee/ui/styles/theme.css`); the `./tailwind-preset` and `./theme-tokens`
  exports are gone.
- All three `tailwind.config.ts` **deleted**; each app's `globals.css` is now
  `@import "tailwindcss"` + `@import "@koolee/ui/styles/theme.css"`. Cross-package
  content scanning via `@source "../src"` inside theme.css.
- PostCSS configs use `@tailwindcss/postcss` only. `components.json` ×3:
  `tailwind.config` now `""` (CSS-first per current shadcn).
- Official codemod (`@tailwindcss/upgrade` 4.3.3) ran per app. **Trap found and
  fixed:** each app's content globs include `packages/ui/src`, so the codemod
  processed ui files three times and over-shifted the shadow scale
  (`shadow-sm` → `shadow-2xs` instead of → `shadow-xs`; bare `shadow` →
  `shadow-2xs` instead of → `shadow-sm`). Hand-corrected 12 occurrences to the
  official single-step mapping. It also renamed cva **variant prop values**
  `"outline"` → `"outline-solid"` in 4 files (env-status ×3,
  transition-controls) — reverted; caught by typecheck.
- v3-parity kept deliberately in theme.css: default border-color =
  `hsl(var(--border))`, buttons `cursor: pointer`, placeholder `gray-400`, and
  `@custom-variant hover (&:hover)` (v4 would gate hover: behind
  `(hover: hover)` — behavior change deferred; remove that line to adopt it).
- One bare `rounded` (admin booking-detail metadata `pre`) → `rounded-sm`
  (0.25rem → 0.375rem; bare `rounded` would have jumped to 0.625rem because the
  radius system routes through `--radius`).

Behavioral to watch in review: shadows/radii should be pixel-identical; hover
still fires on touch (kept v3 semantics); `sky-950` explicitly disabled to
match v3's replaced scale.

Verification: full gate green (build/lint/typecheck/test ×3 apps + packages;
core 142 passed/10 skipped — unchanged). Smoke: 3 apps HTTP 200, zero error
strings; compiled CSS 75.6/63.2/66.6 KB containing `--color-navy/sky/tag`
tokens, `.bg-tag`, `.container`, accordion keyframes; `/faq` (accordion +
tw-animate) clean; no unknown-utility warnings in dev logs.

## Phase 2 — Stripe trio + API version pin — DONE, gate GREEN

Versions: stripe 17.7.0 → ^22.4.0, @stripe/stripe-js 5.10.0 → ^9.12.1,
@stripe/react-stripe-js 3.10.0 → ^6.8.0.

- `apiVersion` pin in the StripeProvider adapter: `2024-12-18.acacia` →
  **`2026-07-29.dahlia`** (the exact literal the installed SDK's
  `Stripe.LatestApiVersion` targets — the old `as` cast is gone).
- Changelogs 18→22 reviewed. Our adapter surface needed **no call-site
  changes**: `new Stripe(...)` (v22 requires class construction — already so),
  params-then-options ordering with explicit `undefined` in `capture()`
  (v22 stopped mixing params/options — already compliant), sync
  `webhooks.constructEvent` (still supported on Node; v21 only added
  misuse errors), no decimal_string/V2/callback/host-override usage.
- Encapsulation invariant verified: `grep` for `from "stripe"` outside
  `packages/core/src/payments/stripe/` returns nothing; web only imports
  `@stripe/*` client libs.
- **New tests** `payments/stripe/provider.test.ts` (11): signed-payload webhook
  verification via `generateTestHeaderString` (valid, wrong-secret, tampered,
  unconfigured-secret) + `normalizeEvent` mapping table. Suite now 153 passed /
  10 skipped (baseline 142/10; delta = these).
- **Live test-mode round-trip** (keys present in apps/web/.env.local):
  PaymentIntent authorize (manual capture, $1.00) → `requires_action` →
  `cancelAuth` OK against Stripe test mode through the v22 adapter.

Behavioral to watch: the API version jump acacia→dahlia is large; our used
surface (PaymentIntents create/capture/cancel, refunds.create, webhook events
`payment_intent.*`, `charge.*`, `refund.created`) is unchanged per the SDK
changelogs, but review the Stripe API changelog before going live.

Verification: full gate 16/16 green; 3-app smoke 200/no error strings.

## Phase 3 — Inngest 3 → 4 — DONE, gate GREEN

Versions: inngest 3.54.2 → ^4.14.0 (core + web). No codemod exists; migrated
per the official v3→v4 guide.

- **Triggers moved into `createFunction` config** (`triggers: [...]`); the old
  second positional argument is gone. Cron now uses the `cron()` helper.
- **`EventSchemas.fromRecord` removed** → per-event `eventType()` definitions
  (`bookingConfirmed`, `agentNoShowCheck`, `exceptionRaised`, exported from
  `@koolee/core/jobs`). `staticSchema<T>()` keeps v3 semantics: compile-time
  types, no runtime validation. `KooleeEvents` type kept for reference.
  The old `as never` cast on the client factory is gone.
- **`signingKey` moved from `serve()` to the client** — now set in web's
  `lib/inngest.ts` via `INNGEST_SIGNING_KEY`; the route handler is just
  `serve({ client, functions })`.
- v4 defaults to cloud mode; our existing `isDev: NODE_ENV !== "production"`
  already handles local dev explicitly.

Behavioral to watch: v4 enables checkpointing + optimized parallelism by
default (we have no `Promise.race` step patterns, so no impact expected).
Future senders should use `bookingConfirmed.create({...})` for typed sends.

Verification: full gate 16/16 green. Live check with `inngest-cli dev` v1.40:
serve endpoint reports `function_count: 3` (schema 2024-05-24), all three
functions registered in the dev server (GQL apps query). Triggered
`booking/confirmed` manually → function executed (step ran; errored only on
the synthetic non-UUID bookingId — data, not migration). The cron function
`cutoff-risk-monitor` fired on its 5-min schedule and completed successfully
("No in-transit bookings at risk", `inngest/function.finished`).

## Phase 4 — Next.js 15 → 16 (+ @next/eslint-plugin-next) — DONE, gate GREEN

Versions: next 15.5.22 → ^16.2.12 (3 apps), @next/eslint-plugin-next
15.5.22 → ^16.2.12.

Already compliant (no changes needed): async `params`/`searchParams`
(all `Promise<>` + awaited), `cookies()` awaited, flat ESLint config,
`eslint .` scripts (never used `next lint`), no AMP / runtime config /
parallel routes / `next/legacy/image` / `next/image` usage at all.

Changes made:
- **Removed the `eslint` block from all three `next.config.mjs`** — the option
  was removed in 16 (`next build` no longer lints; our lint is a turbo task).
- **Dropped `--turbopack` from dev scripts** — Turbopack is the default for
  dev and build in 16. No custom webpack config exists, so builds use
  Turbopack now (previously webpack for `next build`).
- **`middleware.ts` → `proxy.ts`** (deprecated convention), function renamed
  `middleware` → `proxy`. ⚠️ Runtime changed edge → nodejs (proxy doesn't
  support edge); `@supabase/ssr` session refresh is runtime-agnostic and the
  auth gate was smoke-verified post-migration.
- **`data-scroll-behavior="smooth"` added to web's `<html>`** — Next 16 stops
  overriding CSS smooth-scroll during SPA navigations; the attribute restores
  the 15 behavior (instant scroll-to-top on nav) since web sets
  `scroll-behavior: smooth` globally.
- **New `apps/web/src/components/client-link.tsx`** — Next 16's `Link` is no
  longer a client reference, so the marketing layout's `linkComponent={Link}`
  injection into client components (`MarketingNav`/`MarketingFooter`) failed
  prerendering ("Functions cannot be passed to Client Components"). A
  `"use client"` wrapper (`ClientLink`) restores the injection pattern.

Behavioral to watch: production builds now Turbopack (bundle/chunking
differences vs webpack; build output no longer prints per-route First Load
JS). `next dev` now outputs to `.next/dev` (concurrent dev+build possible —
the Phase-0 dev/build `.next` clash class goes away). Vite CJS deprecation
warning in `turbo test` is from vitest 2, resolved by Phase 9.

Verification: full gate 16/16 green. Smoke: 3 homepages 200; dynamic routes
web `/book/flight` 200, admin `/bookings` 200 (DB-backed), agent `/scan` 200;
proxy auth gate verified (`/trips` → 307 `/login?returnTo=%2Ftrips`); agent
PWA intact (`/sw.js` + `/manifest.webmanifest` 200). No errors/deprecations
in dev logs.

## Phase 5 — zod 3 → 4 — DONE, gate GREEN

Versions: zod 3.25.76 → ^4.4.3 (core + 3 apps).

- Deprecated string formats migrated to v4 top-level forms:
  `z.string().url()` → `z.url()` (env.ts ×3), `z.string().uuid()` → `z.uuid()`
  and `z.string().datetime()` → `z.iso.datetime()` (booking draft),
  `z.string().trim().email(msg)` → `z.string().trim().pipe(z.email(msg))`
  (waitlist — `.pipe` keeps the trim-before-validate order).
- Error API: the repo already used `.issues` (never `.errors`), no custom
  error maps — no changes needed. `z.record` already used the two-arg form.
- **Booking-critical schema tests:**
  - `bookingDraftSchema` (booking creation + bag data) extracted to
    `apps/web/src/lib/booking-draft-schema.ts` (the old module imports
    `next/headers`, untestable outside a request; `booking-draft.ts`
    re-exports so no call site changed). **apps/web got a minimal vitest
    setup** (vitest ^2.1.8 to match core, `vitest.config.ts`, `test` script)
    with 12 tests: full valid draft + empty draft parse; rejects bad
    bagCount (0/11/1.5), unknown airport/tier, malformed datetime, non-uuid
    ids, bad IATA length, overlong flight number.
  - Core `pricingRuleInputSchema`/`discountRuleSchema`: existing engine tests
    already parse valid fixtures and reject malformed rules
    (`baseFeeCents: -100`, fractional `perBagCents`) — confirmed green on v4.
  - Ticket-extraction review form input: **no such schema exists in the
    codebase yet** — nothing to test; flagging so it gets a schema + tests
    when built.
- Deviation note: Phase 9 says vitest 2→4 "core only" — apps/web now also has
  vitest, so Phase 9 bumps both.

Verification: full gate 17/17 green (new web test task included; core still
153/10). Smoke: homepages + `/waitlist` + `/pricing` (zod-backed form/action
pages) 200 with no error strings.

## Phase 6 — ESLint 10 stack — DONE, gate GREEN

Versions: eslint 9.39.5 → ^10.8.0 (every workspace), @eslint/js → ^10.0.1,
globals 15.15.0 → ^17.8.0, eslint-plugin-react-hooks 5.2.0 → ^7.1.1.

- Peer check (the anticipated blocker): typescript-eslint 8.65.0 already
  tolerates `eslint ^10` (unchanged, per out-of-scope rule), react-hooks 7
  tolerates ^10, @next/eslint-plugin-next declares no peers. The one problem
  package, **eslint-plugin-react (latest 7.37.5 caps at `^9.7`), turned out to
  be a declared-but-never-imported dependency** of @koolee/config — none of
  the flat configs use it (only react-hooks). Removed the dead dependency
  instead of holding the phase.
- Shared flat configs needed no removed-API cleanup.
- react-hooks 7 recommended rules surfaced no new violations.
- **Genuine pre-existing bug found by ESLint 10's new `preserve-caught-error`
  rule** (`packages/core/src/services/customers.ts`): the unique-violation
  fallback path rethrew a fresh "Update … returned no row" error without
  attaching the original caught error. Fixed by passing `{ cause: error }`.

Verification: `turbo lint` zero errors, run twice for config-resolution
stability; full gate green (build/typecheck/tests unchanged); 3-app smoke 200.

## Phase 7 — Drizzle ORM 0.38 → 0.45 + drizzle-kit 0.30 → 0.31 — DONE, gate GREEN (one verification tier environment-blocked, see below)

Versions: drizzle-orm 0.38.4 → ^0.45.2 (db + core), drizzle-kit 0.30.6 →
^0.31.10. Bumped together as required.

- **Breaking change that bit us: drizzle-orm ≥ 0.44 wraps every driver error
  in `DrizzleQueryError` with the postgres-js error on `.cause`.**
  `isUniqueViolation` in `packages/core/src/services/customers.ts` checked
  `error.code === "23505"` on the top-level error — it now walks the cause
  chain (works with both shapes). No other code inspects driver error codes
  (repo-wide grep for `23505`/`23P01`/`.code`).
- Classic `relations()` API, `drizzle(postgres-js)` client, and
  `drizzle.config.ts` shape are all still valid in 0.45/0.31 — no changes.
  Existing applied migrations untouched.
- `drizzle-kit check`: "Everything's fine". `drizzle-kit generate`
  (offline — diffs schema against `drizzle/meta` snapshots): **"No schema
  changes, nothing to migrate"**, and a byte-level diff of the `drizzle/`
  folder before/after confirms nothing was rewritten. So the 0.31 upgrade did
  not change introspection/casing semantics for this schema.

### ⚠️ Environment-blocked verification (for Tarun to run once)

The seed + live booking-transaction checks require **local** Postgres
(remote Supabase is explicitly off-limits for this phase), but this machine
currently has **no container runtime** (no docker/colima/OrbStack binary) and
nothing listening on 5432/5433, so `docker-compose.yml` cannot start. Once
Docker is available:

```bash
docker compose up -d                                   # koolee-postgres on :5433
cd packages/db
DIRECT_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee pnpm db:migrate
DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee pnpm seed
cd ../..
TEST_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee \
  pnpm --filter @koolee/core test:integration
```

The integration suite (the 10 always-skipped tests) is exactly the required
coverage: `createBooking (integration)` exercises the transactional insert
across bookings/bags/custody_events/slots, and `custody_events append-only
trigger` asserts updates/deletes are rejected.

Verification run: full standard gate 17/17 green (unit suites use the fake
provider and in-memory paths; 153/10 + 12 unchanged), plus the offline
drizzle-kit checks above.

## Phase 8 — Node 22 → 24 — DONE, gate GREEN

- `.nvmrc` 22 → 24; root `engines.node` `>=22` → `>=24`; `@types/node`
  ^22.10.7 → **^24.13.3** in all five workspaces that declare it (not 26 —
  types track the runtime).
- No CI config, no Dockerfile in the repo — nothing else pins Node.
- From-scratch reinstall (`rm -rf` all node_modules → `pnpm install`) under
  Node v24.15.0: clean, no postinstall failures (esbuild/sharp/protobufjs are
  the allow-built trio in pnpm-workspace.yaml and all built fine — vitest/tsx
  run on esbuild, Next image opt on sharp).
- Note: the machine was already running Node 24 since Phase 0, so every prior
  phase's gate also ran on 24 — this phase just aligned declarations.

Verification: full gate 17/17 green from the clean install; 3-app smoke 200.

## Phase 9 — Small-batch bumps — DONE, gate GREEN

Versions: lucide-react 0.474.0 → ^1.28.0 (3 apps + ui), sonner 1.7.4 → ^2
(ui), dotenv 16.6.1 → ^17.4.2 (db), vitest 2.1.9 → ^4 (core **and web**, per
the Phase 5 deviation note), turbo 2.10.7 → ^2.10.8 (root range tightened
from the stale ^2.3.3).

- lucide 1.x: all 18 imported icon names checked against the installed 1.28
  exports. 17 are canonical; `CheckCircle2` (deprecated alias) renamed to
  canonical `CircleCheck` in waitlist-form.tsx. Aliases still ship in 1.28,
  so this was proactive, not build-breaking.
- sonner 2: the ui `Toaster` wrapper (`ToasterProps`, `toastOptions.classNames`)
  is v2-compatible unchanged; there are no `toast()` call sites yet.
- vitest 4: both configs needed no changes (no coverage provider, no changed
  matchers/mocks). Skip counts identical to baseline (core 153 passed /
  10 skipped — the opt-in integration files; web 12 passed). The "CJS build
  of Vite is deprecated" warning from vitest 2 is gone.
- dotenv 17: db env loading verified via `drizzle-kit check` (dotenv 17.4.2
  resolves and loads).
- Incidental: react/react-dom resolved within their existing ^19.0.0 range to
  19.2.8 during installs (range untouched; React itself remains out of scope).

Verification: full gate 17/17 green; smoke: 3 homepages 200, 48 lucide svgs
rendered on the web homepage, waitlist page (CircleCheck + toast flow) 200,
Toaster mounted in the web layout HTML.

## Phase 10 — Final acceptance — GREEN

- Clean install from lockfile (`rm -rf` all node_modules → `pnpm install`):
  **zero peer warnings, zero deprecated-subdependency warnings** (the five
  present at baseline disappeared with the vitest/dotenv chains).
- Full standard gate: 17/17 tasks green.
- All three apps running **simultaneously**: primary routes 200; dynamic
  routes web `/book/flight` 200 + `/trips` 307→login (auth gate), agent
  `/scan` and `/offline` 200, admin `/bookings` 200. No error strings.
- `pnpm outdated -r` after-state: **exactly two rows, both out-of-scope by
  design** — `@types/node` 24.13.3 (26 exists; types track the Node 24
  runtime) and `typescript` 5.9.3 (7.x exists; TS 6/7 explicitly excluded).
  Everything in scope is on its current major.
- Range check: every `package.json` range resolves to the installed major
  (0.x compared at minor precision) — verified programmatically across all
  8 manifests.

### After table (in-scope packages)

| Package | Before | After |
|---|---|---|
| tailwindcss | 3.4.19 | 4.3.3 (+ @tailwindcss/postcss) |
| tailwind-merge | 2.6.1 | 3.6.0 |
| tailwindcss-animate | 1.0.7 | → tw-animate-css 1.4.0 |
| stripe | 17.7.0 | 22.4.0 (API pin 2026-07-29.dahlia) |
| @stripe/stripe-js | 5.10.0 | 9.12.1 |
| @stripe/react-stripe-js | 3.10.0 | 6.8.0 |
| inngest | 3.54.2 | 4.14.0 |
| next | 15.5.22 | 16.2.12 |
| @next/eslint-plugin-next | 15.5.22 | 16.2.12 |
| zod | 3.25.76 | 4.4.3 |
| eslint | 9.39.5 | 10.8.0 |
| @eslint/js | 9.39.5 | 10.0.1 |
| globals | 15.15.0 | 17.8.0 |
| eslint-plugin-react-hooks | 5.2.0 | 7.1.1 |
| eslint-plugin-react | 7.37.5 | removed (unused, blocked eslint 10) |
| drizzle-orm | 0.38.4 | 0.45.2 |
| drizzle-kit | 0.30.6 | 0.31.10 |
| lucide-react | 0.474.0 | 1.28.0 |
| sonner | 1.7.4 | 2.x |
| dotenv | 16.6.1 | 17.4.2 |
| vitest | 2.1.9 | 4.x (core + web) |
| turbo | 2.10.7 (range ^2.3.3) | 2.10.8 (range ^2.10.8) |
| Node / @types/node | 22 / 22.20.1 | 24 / 24.13.3 |
