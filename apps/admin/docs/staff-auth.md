# Staff auth — agent + admin apps

Shipped 2026-08-09 (overnight run 1, Phase 2). Replaces the dev session
stubs that previously threw outside `NODE_ENV=development`.

## Design (fixed decisions)

- **Method:** email + password ONLY (`signInWithPassword`). Password reset
  via Supabase `resetPasswordForEmail` (emails land in Mailpit locally). No
  OTP, no magic links, no OAuth for staff.
- **No self-signup**, and — read carefully — **signups stay enabled on the
  Supabase project.** The customer funnel creates accounts on its own:
  `ensureDraftSession` calls `signInAnonymously()`, and when the project has
  anonymous sign-ins disabled it degrades to cookie-only draft state and the
  account is created at the OTP gate instead. Either way account creation
  cannot be disabled project-wide, and it is NOT the security boundary. The
  boundary is the **role**: every agent/admin page, server action, and route
  handler resolves the session's role through
  `requireStaffRole` in `packages/core/src/services/staff.ts` (wrapping the
  `assertRole` seam from auth close-out item #9). An authenticated account
  with no active `staff_members` row gets nothing. Do not "fix" access
  control by disabling signups — you will break the funnel and gain nothing.
- **Invites:** admin-only, fully server-side. The admin app's `/staff` page
  calls `auth.admin.inviteUserByEmail` with the service-role key (which ONLY
  the admin app holds — the agent app's least-privilege env stance is
  preserved: no service key, no Stripe, no messaging creds) and writes the
  role assignment (`agent` | `admin`) in the same action via
  `createStaffMember`. The role value is validated server-side twice (action
  schema + core service); it is never self-selected and never assigned
  client-side. The invitee's emailed link lands on `/auth/callback` in the
  app matching their role (agent → :3001, admin → :3002), which verifies the
  token and forwards to `/set-password`.
- **Deactivation:** the Deactivate button on `/staff` flips
  `staff_members.active` to false. Because the role lookup runs on **every
  request**, a deactivated staff member fails `assertRole` on their next
  request even with a live session — no token revocation needed for
  correctness (see Hardening notes below). An admin cannot deactivate their
  own account (the action refuses it): locking yourself out mid-session
  helps nobody, and another admin can always do it.

## Data model

`staff_members` (migration `0004`): one row per user — `user_id` (unique,
FK users), `role` (CHECK-constrained to `agent`/`admin`), `active`,
`invited_by_user_id`, timestamps. Rows are never deleted; deactivation keeps
the assignment history attributable.

`public.users.role` is kept in sync at assignment time (it feeds
`custody_events.actor_role`), but authorization reads `staff_members` only.

## Agent task scoping

Agents are task-scoped everywhere (`packages/core/src/services/tasks.ts`):

- `listAssignedTasks` filters by `assignee_user_id` = the session user;
- `getAssignedTask` resolves a task **only** for its assignee (someone
  else's task id 404s);
- `canActOnBooking` (`packages/core/src/auth/types.ts`) answers `false` for
  agents synchronously — agent booking access goes through
  `sessionCanActOnBooking` / `agentHasTaskForBooking` in
  `packages/core/src/services/bookings.ts` (a real assignment lookup).
  Assignment _creation_ shipped in Phase 7: an admin assigns from a
  booking's detail page (see `ops-console.md`).

## Local development

`pnpm seed:local` (one command from the repo root — it pins both database
URLs to the local stack and loads `.env.test` itself) creates the full dev
roster:

| Account                             | Credential           | Role     |
| ----------------------------------- | -------------------- | -------- |
| `admin@koolee.local` (Alex Morgan)  | `koolee-admin-dev-1` | admin    |
| `admin2@koolee.local` (Priya Rao)   | `koolee-admin-dev-2` | admin    |
| `agent@koolee.local` (Leo Vargas)   | `koolee-agent-dev-1` | agent    |
| `agent2@koolee.local` (Nina Petrov) | `koolee-agent-dev-2` | agent    |
| `agent3@koolee.local` (Sam Okafor)  | `koolee-agent-dev-3` | agent    |
| `agent4@koolee.local` (Tara Lin)    | `koolee-agent-dev-4` | agent    |
| `agent5@koolee.local` (Jonas Weber) | `koolee-agent-dev-5` | agent    |
| `+1 332 260 2830` (Casey Rivera)    | OTP `123456`         | customer |
| `+1 332 260 2831` (Morgan Lee)      | OTP `123456`         | customer |

The customer phones are `[auth.sms.test_otp]` entries in
`supabase/config.toml` — valid-format numbers so the web UI accepts them; no
SMS is ever sent. The seed **refuses** to create any of these on a non-local
Supabase host — known passwords on a hosted project would be a standing
backdoor.

Data-persistence rules (why you should never lose these accounts again):

- the local Postgres lives in a Docker volume — `supabase stop`/`start`
  and reboots preserve all data;
- `pnpm test` is **unit-only** and never touches the database;
- `pnpm --filter @koolee/core test:integration` is the only command that
  truncates tables, and it **re-seeds the roster automatically** when it
  finishes (pass or fail);
- even direct vitest invocations (IDE test extensions, other sessions)
  self-heal: `packages/core/vitest.global-setup.ts` (wired in as
  `globalSetup` from `vitest.config.ts`) returns a teardown that probes the
  seed markers — the dev admin account and an active pricing rule — after
  every run, and re-seeds if either is gone. It only acts when
  `TEST_DATABASE_URL` points at localhost;
- if data ever looks wrong anyway, `pnpm seed:local` restores everything in
  one command.

`supabase/config.toml` allowlists the staff apps' `/auth/callback` URLs
(:3001/:3002) in `additional_redirect_urls` — the hosted project's dashboard
needs the same entries for the deployed origins at launch.

## Hardening notes (from the retired TODO(auth-*) spec)

- **Rate limiting / lockout on sign-in:** GoTrue's built-in rate limits
  apply (`[auth.rate_limit]` locally; dashboard-configured hosted). No
  app-level lockout was added — revisit before public exposure if the
  built-ins prove insufficient.
- **Session revocation on deactivation:** enforced by the per-request role
  check (immediate denial). The Supabase session token itself stays
  technically valid until expiry — it just can't reach anything. For
  belt-and-braces token revocation, ban the user via the admin API.
- **Device binding / short session TTLs for agent devices:** JWT expiry is
  project-level Supabase config (`jwt_expiry`, locally 3600s). Set a shorter
  TTL for production in the dashboard if desired; not enforceable per-app
  from this codebase.

## Tests

`packages/core/src/services/staff-auth.integration.test.ts` — role-guard
matrix (customer / anonymous / unknown / wrong role / deactivated / allowed),
invite flow (auth user + role row + Mailpit capture + role restriction), and
the full password-reset round trip through Mailpit.
