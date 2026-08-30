# F2 — hosted setup

> **Everything slice F2 needs on a hosted environment that a migration cannot
> do for you.** Written for TD; nothing here was run by the session that built
> the slice, which touched LOCAL only.
>
> Companion docs: [realtime-signals.md](realtime-signals.md),
> [notifications.md](notifications.md),
> [storage-and-avatars.md](storage-and-avatars.md).

---

## 0. The short version

| # | Step | Where | Blocking? |
|---|---|---|---|
| 1 | Apply migrations `0030` + `0031` | CI on merge, or by hand | **yes** |
| 2 | Confirm `booking_signals` is in the `supabase_realtime` publication | Supabase dashboard | no — degrades to polling |
| 3 | Nothing else | — | — |

**No new environment variables**, in any app or in core. That is a claim worth
checking rather than trusting: the browser clients use
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which all three
apps already read, and the customer-facing exception email takes its support
address from `SITE.contactEmail` in `apps/web` — public site copy, not
configuration.

**No new storage bucket.** The `avatars` bucket and its policies shipped with
`0026`/`0027`; F2 added an upload SURFACE (an admin replacing a staff photo),
not new infrastructure.

---

## 1. Migrations

`0030_booking_signals.sql` and `0031_booking_signals_grant.sql`. Applied by CI
on merge like every other migration, or by hand over the **direct** connection:

```bash
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:migrate
```

Read the `Target host:` line it prints before it runs. Then, always:

```bash
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:status
```

`db:status` is read-only, safe against production, and compares CONTENT
HASHES. Never take migration state from prose, this file's included.

**Locks.** `0030` creates one small table, two foreign keys and one index;
`0031` is a single `GRANT`. `0030`'s backfill (`INSERT … SELECT id FROM
bookings`) touches one row per existing booking — trivial at current volumes,
and it takes no lock on `bookings` beyond a share lock for the read.

**The trigger is the part to notice.** `0030` adds an `AFTER INSERT` trigger to
`custody_events`. It fires once per appended event and does one upsert. It does
NOT change what `custody_events` accepts, and the three append-only guards from
`0001` are untouched.

### Verify

```sql
-- The doorbell, its policy, its grant, its publication membership.
select relrowsecurity, relreplident from pg_class where oid = 'public.booking_signals'::regclass;
select policyname, cmd from pg_policies where tablename = 'booking_signals';
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'booking_signals' and privilege_type = 'SELECT';
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
select tgname from pg_trigger where tgrelid = 'public.custody_events'::regclass and not tgisinternal;
```

Expected: `relrowsecurity = t`, `relreplident = f` (FULL), exactly one policy
(`booking_signals_select_watchable`), a `SELECT` grant to **`authenticated`**
and to nobody else, `booking_signals` in the publication, and four triggers on
`custody_events` (the three append-only guards plus
`custody_events_touch_signal`).

**If the grant row is missing, realtime is silently dead** — every page reports
itself as polling and nothing errors. That is the exact bug `0031` exists to
fix; see its header.

---

## 2. Realtime must be on for the table

`0030` adds `booking_signals` to the `supabase_realtime` publication and sets
`REPLICA IDENTITY FULL`, which is everything SQL can do. Confirm in the
dashboard under **Database → Replication** that the `supabase_realtime`
publication is enabled and lists `booking_signals`.

If it does not, every client falls back to polling every 30 seconds. That is a
degradation, not an outage, and it is the intended shape of that failure — but
it is worth not shipping.

---

## 3. What to smoke-test, in order

1. **Live, two windows.** Open a booking's trip page as the customer and the
   same booking's task in the agent app, side by side. Have the agent act
   (arrive, or seal a bag). The customer's chain of custody must grow within a
   few seconds with nobody touching that window. Locally this measured **3.0 s**
   against a 30 s fallback.
   *Quick check without acting:* the page carries
   `<span data-live-signal="live|connecting|polling">`. `live` means the socket
   is connected; `polling` means it is not, and everything still works.
2. **The new emails.** Assign an agent to a paid booking → "…is on your
   pickup". Complete a verification visit → "Bags sealed — choose your driver",
   with the seal numbers. Raise an exception → ops gets the reason, the
   customer gets "We're on it" and **no reason at all**.
3. **The funnel door.** `/book/flight` opens on the upload area, "Enter your
   flight details manually" is one tap below it, and an unreadable file lands
   on the manual form with a non-blaming line rather than a red banner.
4. **Trips home.** `/trips` splits Upcoming (soonest first, with needs-action
   badges) from Past, and the "Finish setting up" card appears only while
   something is missing.
5. **Staff photo.** Console → `/staff` → **Photo** on any row. A customer's
   photo must NOT be reachable from there.
6. **Staff history.** Console → `/staff` → click a name. Counts, a date range
   that lives in the URL, rows linking to bookings, shifts below.

---

## 4. What this slice deliberately did not build

- **Web push.** Out of scope by decision; the coverage is in-app realtime plus
  email. Backlogged as its own item for the agent PWA.
- **SMS.** Parked on A2P registration. The notification matrix carries an SMS
  column marked *parked* so the seam's future is explicit; there is no code.
- **A notifications table.** Email sends live in Inngest, so the admin trip
  history says so rather than implying that no line means no email. Adding
  bookkeeping on the send path to make it queryable was explicitly not done.
- **An offline outbox.** The agent app says "you're offline, this is what we
  last loaded" and queues nothing. A durable outbox for custody capture is real
  work with real correctness questions.
