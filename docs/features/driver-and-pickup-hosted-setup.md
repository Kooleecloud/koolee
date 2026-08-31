# Hosted setup — driver role, shifts, and the pickup run

> **What reaches a hosted environment automatically, and what does not.**
> Build log: [../run-reports/RUN-REPORT-7.md](../run-reports/RUN-REPORT-7.md).
>
> ⚠️ **Migrations are applied by CI, not by hand.**
> [`.github/workflows/migrate.yml`](../../.github/workflows/migrate.yml) runs on
> every push to `dev` and `main` that touches `packages/db/drizzle/**`, applies
> pending migrations to that branch's database (`dev` → hosted dev, `main` →
> production), and then runs `db:status` to assert the applied set matches the
> checkout by content hash. Merging is the deploy. Do not also run
> `pnpm db:migrate` against hosted by hand — see §2.

---

## 1. New environment variables

**None.** Nothing in this slice reads a new environment variable, in any app or
in `packages/core`.

Stated explicitly because "no new env" is the kind of claim worth being able to
check:

- the **ETA estimator** is a seam injected through `createRuntime`, and its one
  implementation is arithmetic over two coordinates — no routing provider, no
  key, no network call;
- the **ZIP centroids** are static reference data in the database, loaded from a
  file in the repo;
- **GPS** comes from the browser's own `navigator.geolocation` and is posted to
  a first-party route handler in the agent app;
- the three new **Inngest functions** register in the same client the other six
  already use, and the ops alert reads the `OPS_ALERT_EMAIL` the exception
  alert already required.

---

## 2. Apply the migrations

Two, applied in one pass:

| Migration                      | What                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0028_geo_zip_centroids`       | `zip_centroids` + 837 rows, `airports.lat/lng` (NOT NULL), and a backfill of `addresses.lat/lng`                                                       |
| `0029_driver_fleet_and_shifts` | `trucks`, `driver_shifts`, `driver_positions`, `staff_members.can_drive`, `pickup_tasks.driver_shift_id` — **and DROPs `drivers`, `routes`, `agents`** |

**Read this before merging: 0029 drops three tables.** `drivers`, `routes` and
`agents` shipped in `0000_init` and were never used — zero rows in every
environment, zero reads and zero writes anywhere outside `schema/` and
`relations.ts`, re-verified by grep immediately before the migration was
written. The migration does not take that on trust: it counts all three and
**`RAISE EXCEPTION`s, aborting the whole migration, if the total is not zero.**

So the failure mode is safe but loud. If CI's migrate step fails with

```
Refusing to drop: agents=0, drivers=1, routes=0. …
```

then something started using a table this migration deletes, and the answer is
to find out what — not to force it through.

The drops run in FK order (routes → drivers → agents) with **no `CASCADE`**.
Drizzle generated `CASCADE` and it was removed on purpose: it would silently
take dependents with it, and the entire claim being made is that there are none.

Migration `0028` also carries a snapshot of the ZIP-centroid dataset, so its
address backfill works before any seed has run. It reports what it did:

```
NOTICE:  addresses: backfilled 8 row(s) from ZIP centroids; 0 row(s) left
         without coordinates (ZIP not in zip_centroids)
```

A row left without coordinates is not a failure — its ETA renders "ETA on the
way" rather than a guess — but the NOTICE names the ZIPs so you can decide
whether the dataset needs widening.

### Verify, do not assume (§3.1)

```bash
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:status
```

Read the `Target host:` line first, every time. Expect `30 of 30 (matched by
content hash)`. Hosted carries one orphan journal row on purpose — leave it
alone.

---

## 3. Seed the reference data

```bash
# Brand-new project only. `pnpm seed` refuses a non-local host without this,
# because it resets the 128 airline-cutoff rows to 45/60 and rewrites the
# active pricing rule — see packages/db/src/seed-guard.ts and MIGRATIONS.md §9.
SEED_ALLOW_HOSTED=1 DATABASE_URL='<hosted pooled url>' pnpm seed
```

Idempotent with respect to **itself**, not to ops's work: on a project where
somebody has verified cutoffs or set launch prices, do NOT run this — enter
those values at the console (`/cutoffs`, `/pricing`) and see
[docs/runbooks/prod-bringup.md](../runbooks/prod-bringup.md). What is new in
this slice:

- **ZIP centroids** — 837 rows, reconciled on every run. The seed is what keeps
  the table current after 0028's snapshot; `packages/db/src/zip-centroids.ts`
  is the file to edit.
- **Airport coordinates** — JFK / LGA / EWR terminal complexes.
- **Two dev trucks** (`DEV Truck A — 30 bags`, `DEV Truck B — 12 bags`). These
  are DEV fixtures. On a real environment, add the actual fleet in the console
  (§4) and take the dev pair out of service.

**The seed never opens a shift.** An open shift asserts "somebody is out
driving right now"; seeding one would put phantom drivers in front of
customers.

Note also: the seed's `can_drive` grants apply only to the **seeded local staff
accounts**, and that block refuses to run against a non-local Supabase host.
Real staff are granted in the console (§4).

---

## 4. TD's manual steps, in order

Nothing below is automated, and none of it is optional if the feature is meant
to work for a real customer.

### 4.1 Add the real fleet — `/trucks`

Console → **Configuration → Trucks**. Per vehicle: a name (free text, unique —
whatever a dispatcher and a driver say to each other) and a **bag capacity**.

Capacity is the denominator of every driver-selection decision: a customer is
only offered a driver whose truck has room for their bags. Getting it wrong
quietly changes who customers can pick.

`reserved_spaces` is editable and **enforced**: a van is offered
`bag_capacity − reserved_spaces − bags already on board`, so spaces you hold
back for a same-day walk-up, a return leg or an oversize item stay empty. It
must be fewer than the capacity — a van with nothing bookable belongs out of
service, and the console refuses the save and says so.

Then **take the two `DEV Truck …` fixtures out of service** on the same page.
Deactivating is refused while a truck is out with a driver, and names them.

### 4.2 Grant `can_drive` — `/shifts`

Console → **Operations → Shifts** → the "Who may drive" panel. Every active
agent is listed; grant the ones who actually drive.

**Driving is a capability, not a role.** The `user_role` enum has carried
`driver` since 0000 and the CHECK still excludes it, deliberately — one person
verifying at the door and driving the van is the v1 reality, and a third role
would force every authorization site to reason about somebody who is an agent
on Tuesday and a driver on Thursday.

`can_drive` defaults to **false**, so no existing agent silently became
selectable as a driver when the migration landed. Nothing works until this step
is done: no shift can start, so no customer can be offered a driver, and every
sealed booking shows as "needs a driver" on the board.

Revoking takes effect on the person's next request. It does **not** end a shift
already under way — use force-end for that.

### 4.3 Confirm the zone rows cover your drivers

Driver selection reuses **`agent_zones`** — the table is shared, not renamed
(198 live rows and an admin CRUD behind it; its FK is already to `users`). The
role filter moved to read time: the driver reader filters on `can_drive` where
the agent reader filters on `role`.

Practical consequence: **a driver with no zone rows is only ever offered
through the widening fallback**, framed to the customer as "coming from a
little further out". Console → **Configuration → Agent zones** adds them.

### 4.4 Check the Inngest registry picked up three new functions

The registry went from 6 to **9**. On Inngest Cloud, after the deploy, confirm:

- `driver-selected-email`
- `bagdrop-delivered-email`
- `driver-pool-empty-ops-alert`

All three are registered in **core's** shared factory and served by `apps/web`.
The agent app's Inngest client is send-only by design (it serves no
`/api/inngest` route) — a function added there would silently never run.

`driver-pool-empty-ops-alert` emails `OPS_ALERT_EMAIL`, which is already a
production boot requirement. With it unset the function logs a skip and the
console alert still fires.

### 4.5 Geolocation needs HTTPS

`navigator.geolocation` is a secure-context API. It works on `localhost` and on
any HTTPS origin, and **not** on a plain-HTTP preview host. If drivers report
that customers cannot see them moving, check the scheme before anything else —
the agent app shows a non-blocking banner and every other part of the pickup
keeps working, which is by design and also means the failure is quiet.

---

## 5. What is deliberately NOT in this slice

Listed so nobody goes looking for it:

- **No Google Maps, no geocoder, no routing API.** Distance and ETA come from
  ZIP centroids and an average speed. `packages/core/src/geo/eta.ts` is the
  seam a provider would implement, and its header documents the known
  calibration bias (long airport runs read pessimistic, which is the safe
  direction for both consumers).
- **No map on the customer's trip page.** Distance and an updating ETA, no
  tiles and no library. See RUN-REPORT-7 Phase 4.
- **No `reserved_spaces` enforcement.** The column exists and nothing reads it.
- **No agent shift tracking.** Shifts are for drivers; the auto-assign that
  places agents stays deliberately shift-blind, and the reasoning is written at
  its call site in `auto-assign.ts`.
- **No route optimisation and no route entity.** A customer picks a driver;
  Koolee does not plan routes.
- **No position history.** `driver_positions` holds one mutable row per driver
  and is explicitly **not** part of the chain of custody.
- **No SMS**, and **no customer-facing driver profiles or photos** beyond the
  first name and avatar the app already holds.
- **No background GPS.** Foreground pings only, ~45 s, while a pickup is
  between "set off" and "delivered".
