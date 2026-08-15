# Time and timezones

Four rules. If you only read one thing, read the first two.

---

## 1. Store absolute instants. Always.

Every point in time is a Postgres `timestamptz`, written as a UTC instant. There
is no naive timestamp anywhere in the schema, and adding one is a bug — see the
convention in `packages/db/src/schema/columns.ts`.

All arithmetic happens on instants (`subMinutes`, `differenceInMinutes`), never
on wall-clock values. This is what makes the airline-cutoff maths correct across
DST by construction: `subHours(t, 3)` on a shifted wall clock is not.

## 2. Display in the **booking's** zone — never the viewer's, never the server's.

Every human-facing time belonging to a booking is rendered in the zone of its
**departure airport**, stored on the row as `bookings.display_tz`.

The customer who buys the window, the agent who shows up for it, and the
dispatcher who plans around it all read **the same string**. Nobody's browser or
device gets a vote. That is the entire guarantee, and it is what stops a
customer being out when the driver rings the bell.

**Why the airport and not the pickup address:**

- the airline bag-drop cutoff is the only hard deadline in the system and it is
  expressed in airport time — every window is derived from it;
- the airport zone is the one zone all three actors share; the pickup address's
  zone is shared by nobody but the customer;
- two zones on one booking means two numbers on the same screen in different
  units, which no amount of labelling survives at 5 AM.

**Always label the zone.** Every formatter appends the abbreviation
(`10:00 AM – 11:00 AM EDT`). A bare "10:00 AM" is read as local by a customer
booking from London, and then the guarantee above is invisible to the one person
it exists to protect.

### How to render

Use the formatters in `packages/core/src/slots/cutoff.ts`. They all take an
explicit `tz` — there is no default, on purpose.

| Function                                      | Output                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `formatWindowInAirportTz(start, end, tz)`     | `Tue 10 Jun, 10:00 AM – 11:00 AM EDT`                    |
| `formatHourRangeInAirportTz(start, end, tz)`  | `10:00 AM – 11:00 AM EDT`                                |
| `formatInstantInAirportTz(instant, tz)`       | `Tue 10 Jun, 6:20 PM EDT`                                |
| `formatDayInAirportTz(instant, tz)`           | `Tue 10 Jun` (a day has no zone)                         |
| `formatDateTimeLocalInAirportTz(instant, tz)` | `2026-06-10T18:20` (for `<input type="datetime-local">`) |
| `dstTransitionNote(start, tz)`                | a warning string on two nights a year, else `null`       |

Where the zone comes from:

- **a booking** — `bookings.display_tz`, or `BookingDetail.tz` / `BoardRow.tz` /
  `VisitContext.tz` / `ScheduledTask.tz`, which all carry it for you;
- **a list spanning airports** — `getDisplayZones(db)` once, then
  `zoneFor(zones, code)` per row;
- **anything else with an airport code** — `resolveDisplayTz(db, code)`.

Never hardcode `"America/New_York"`. All three airports are Eastern today, which
is exactly why a hardcoded zone would go unnoticed until the day it is wrong.

### Times that belong to no booking

Account milestones ("phone verified", "staff member added", "draft last edited")
have no airport and therefore no zone. Render them **relative**
(`formatDistanceToNow`) — elapsed time needs no zone at all.

## 3. Bucket days at the airport, sort by instant.

- `airportLocalDayBounds(instant, tz)` for any "today"/"this day" query. Never
  `setHours(0, 0, 0, 0)`: server-local midnight is **UTC** midnight in
  production, which slices an Eastern day at 8 PM the evening before.
- `airportLocalInstant(day, hour, tz)` for ops input ("block Aug 12, 2 PM at
  JFK") — resolved against the zone of _that airport_.
- **Sort by absolute instant, never by rendered local time.** On a mixed-zone
  list a 9 AM Pacific pickup would otherwise sort above a 10 AM Eastern one that
  happens three hours earlier.
- A day-bounded _query_ needs one boundary, so it takes one zone. When the ops
  board is filtered to a single airport it uses that airport's; otherwise
  `OPS_CONSOLE_TZ` stands in. Display is still per row.

## 4. DST: two nights a year, and we sell windows on both.

Koolee runs 24/7/365, so both edges are inventory customers pay for.

- **Fall back** — two distinct one-hour windows both render `1:00 AM – 2:00 AM`.
  `EDT` vs `EST` separates them technically, but no customer reads it that way,
  so `dstTransitionNote` says it in words: _"first of two — clocks go back during
  this hour"_.
- **Spring forward** — the 2 AM hour does not exist, so the picker jumps 1 AM →
  3 AM. Nothing is missing, but an unexplained gap reads as a bug.

Detection is by observation (does the adjacent hour carry the same wall-clock
label?), not a table of transition dates — so it works in any zone, including
the half-hour ones, with nothing to maintain.

`formatWindowInAirportTz` labels a window by the zone in force at its **end**:
a window straddling the transition is handed over after the clocks change, and
the hand-over is the moment the agent and customer must agree on.

---

## The two zone columns on `bookings`

| Column           | Meaning                                                | May it drive display?                    |
| ---------------- | ------------------------------------------------------ | ---------------------------------------- |
| `display_tz`     | The departure airport's zone, snapshotted at creation. | **Yes — it is the only thing that may.** |
| `booked_from_tz` | The customer's own zone when they booked, best-effort. | **Never.**                               |

`display_tz` is denormalized from `airports.tz` on purpose and never updated. It
makes a booking row **self-describing**: any app, in any language, can read the
row and render the window correctly with no join, no config, and no
institutional knowledge. That property is what stops a new consumer from
defaulting to the viewer's or the server's zone. It also means a receipt renders
in 2030 exactly as it did the day it was bought.

`booked_from_tz` is metadata: support triage ("did they think 10 AM was their
time?"), sane notification send-times, and showing "all times are local to JFK"
only to the customers who are not local. If it ever reaches a formatter, we have
rebuilt the exact confusion this document exists to prevent.

## The one deliberate exception: the ops console

Dispatch is not tied to one place, and the board shows bookings from several
airports at once. So in the admin app only:

- every time is labelled with **its own booking's** zone, always;
- `ViewerLocalTime` hangs the operator's local reading off it as **secondary**
  text, and renders nothing when the zones match.

It never appears alone. The booking-zone time stays the authoritative one,
because it is the number the customer and the agent are working from.

## Enforcement

`no-restricted-syntax` in `packages/config/eslint/base.mjs` bans `toLocale*`,
bare `Intl.DateTimeFormat`, and two-argument date-fns `format()` — all three
silently fall back to the system zone, which is UTC in production, so the bug
they cause has no error attached to it.

Exempt: `packages/core/src/slots/cutoff.ts` (the formatters themselves) and two
call sites with inline `eslint-disable` comments explaining why viewer-local is
correct there.
