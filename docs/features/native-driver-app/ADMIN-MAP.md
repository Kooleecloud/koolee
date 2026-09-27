# Admin live driver map

> **Every driver on shift, on one map on `/shifts`, moving as their phones
> report.** Phase 6 of the native driver app
> ([RUN-REPORT-16](../../run-reports/RUN-REPORT-16.md)). For the rule that
> keeps realtime from becoming a second data path read
> [realtime-signals.md](../realtime-signals.md); this page is the one
> deliberate exception to it, and says why.

---

## 1. What the map shows

One pin per **open shift** with a known position. The pin carries the driver's
given name and the truck (`Marcus · Van 2`); tapping it opens a card with the
full name, the truck, bags aboard and "last seen N min ago".

Three states, and they are the same three the shift cards and the nudge job
use (`positionHealthOf`, `POSITION_GAP_MS` = 2 min):

| State          | On the map                      | In the legend   |
| -------------- | ------------------------------- | --------------- |
| fix inside gap | sky pin, pulsing                | `N live`        |
| fix past gap   | grey pin, no pulse (last known) | `N stale`       |
| never reported | no pin — nothing honest to draw | `N no position` |

Health is re-judged in the browser every 10 s from `recorded_at`, so a driver
who goes quiet turns grey without a refresh. "Show every driver" re-frames the
fleet after the operator has panned.

**Where the data comes from.**

- The roster (who is out, truck, bags, last fix) is `listLiveDrivers(db)` in
  `packages/core/src/services/live-drivers.ts`, rendered by the server page
  and refreshed by `router.refresh()` every 15 s. This is the source of truth.
- The socket (`apps/admin/src/app/shifts/drivers-map.tsx`) lays **newer fixes
  over** that roster so a pin moves within a second of the phone reporting.
  A fix is only applied when its `recorded_at` is newer than what the server
  rendered — the same device-clock rule core's upsert orders on — so a poll
  landing just after a socket event never steps a pin backwards.
- A watched shift closing (`driver_shifts` change) triggers a refresh; the
  server drops the pin. A **new** shift is the one thing the filters cannot
  see, which is why the poll stays at 15 s even while the socket is live.

**Why a payload is rendered here.** `booking-signal.ts` says realtime is a
signal, never a source. This map renders three numbers off the wire — lat,
lng, recorded_at — validated field by field (`readPositionChange`), about a
row the same browser is already allowed to SELECT, and overwritten by the
server's copy on the next poll. Refetching six queries per fix per driver
every 5 s was the alternative.

**Subscriptions are filtered, never unfiltered.** One channel
(`admin-drivers`), one `postgres_changes` handler per open shift on
`driver_positions` (`staff_user_id=eq.<id>`) and one on `driver_shifts`
(`id=in.(…)`). With nobody out, nothing is subscribed and the page polls.
An unfiltered subscription on an RLS table reports `CHANNEL_ERROR`.

The hidden `<span data-fleet-map="live|connecting|polling">` on the page says
which transport is actually in use.

## 2. The four-part recipe (migration 0039)

All four, or the socket silently delivers nothing. Precedent: 0030 + 0031.

1. **`REPLICA IDENTITY FULL`** on `driver_positions` and `driver_shifts` —
   Realtime needs the whole row to evaluate RLS per subscriber.
2. **Publication membership** — `ALTER PUBLICATION supabase_realtime ADD TABLE`
   for both. Without it no events are emitted at all.
3. **A SELECT policy for `authenticated`**, admins only:
   `public.is_active_admin(auth.uid())`, a SECURITY DEFINER check for an
   ACTIVE `staff_members` row with `role = 'admin'`. Evaluated against the
   browser's own session, so a driver's browser cannot watch every other
   driver.
4. **`GRANT SELECT … TO authenticated`** on both tables. A policy grants
   nothing by itself; without this the subscription reports SUBSCRIBED and
   delivers zero rows (the 0031 lesson).

Server-side reads are unchanged: `@koolee/core` still reads on the pooled
`postgres` connection and bypasses RLS. The policy exists for the browser's
Realtime socket only. Never `anon`; never a service-role key in the browser —
`apps/admin/src/lib/supabase/browser.ts` is anon-key only and exists only for
this.

## 3. Hosted checklist

- [ ] Apply 0039 (with the rest of the run's migrations — CHECKLIST F1).
- [ ] Supabase dashboard → **Database → Replication** → the
      `supabase_realtime` publication must list **`driver_positions`** and
      **`driver_shifts`**. The migration adds them when it runs as `postgres`;
      confirm rather than assume, because 0030's `booking_signals` needed the
      same check.
- [ ] Open `/shifts` as an admin with a driver on shift and check the DOM:
      `data-fleet-map="live"`. `polling` means one of the four parts above is
      missing.

## 4. Running it locally

`apps/admin`'s `dev` and `build` scripts now run
`scripts/copy-maplibre-worker.mjs apps/admin` first, exactly as `apps/web`
does. Skip it and the map fetches its style and tiles' metadata and then never
draws a tile, with no error — see the header of that script.
