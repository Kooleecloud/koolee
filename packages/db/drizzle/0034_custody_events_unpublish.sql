-- ---------------------------------------------------------------------------
-- 0034 — `custody_events` leaves the Realtime publication.
--
-- THE TRAP THIS CLOSES, and why it closes it the other way round.
--
-- 0031 fixed a real bug: `booking_signals` was in the publication with RLS on
-- and one SELECT policy, and no browser ever received a change event, because
-- a POLICY DOES NOT GRANT ANYTHING — `authenticated` held no SELECT, so
-- Realtime's per-row check failed before the policy was consulted. It failed
-- the way this class of bug always fails: silently, zero rows, no error.
--
-- 0031's own header then recorded that `custody_events` has carried the SAME
-- shape since 0001 — RLS on, in the publication, no SELECT grant — and
-- deliberately did NOT widen it, because nothing subscribes to it. That note
-- has sat there since as a pre-staged failure: the next person to point a
-- `.channel()` at this table gets zero events and no error, and the fix looks
-- like "add the grant" long before it looks like "nobody meant to open this".
--
-- The slice that reopened it defaulted to ARMING the subscription — grant the
-- SELECT, match the 0031 precedent — and the evidence argued the other way on
-- two counts, so TD ratified the reverse:
--
--   1. NOTHING SUBSCRIBES. The customer's custody timeline is server-rendered
--      through Drizzle, and the realtime layer is `booking_signals`: a
--      doorbell that says THAT a booking changed, after which the client
--      refetches through the ordinary server path. That is the standing
--      architecture rule (PROJECT-STATUS §7, "realtime is a signal, never a
--      source of truth"), and a second table streaming actual custody rows to
--      browsers would be the first exception to it.
--
--   2. THE POLICY COVERAGE IS NOT WHAT THE SLICE ASSUMED. It expected two
--      policies — customer-sees-own and staff-sees-assigned. There is ONE
--      (`custody_events_select_own`, from 0001). No staff policy exists.
--      Granting SELECT against that would open the table to `authenticated`
--      with only the customer half written, which is the narrower risk of the
--      two but is still a privilege change with no feature behind it.
--
-- So the membership goes instead. A table nobody reads from a browser should
-- not be in a publication: leaving it there costs WAL decoding on every
-- insert for a stream with no subscriber, and it keeps the trap armed.
--
-- WHAT IS DELIBERATELY LEFT ALONE:
--
--   * `custody_events_select_own` — the policy is CORRECT, costs nothing on a
--     table with no client SELECT grant, and removing it would be a second
--     change with its own blast radius. It also documents the intent if a
--     client-side read is ever genuinely wanted.
--   * REPLICA IDENTITY FULL — pointless now, and free: the table is
--     append-only (0001's triggers refuse UPDATE, DELETE and TRUNCATE), so
--     there is no statement whose WAL volume it can inflate.
--   * `booking_signals` — untouched. Its trigger still fires on
--     `custody_events` AFTER INSERT, so roughly twenty services keep
--     signalling correctly without knowing either table exists.
--
-- REVERSIBLE in one statement, and if it is ever reversed the GRANT must go
-- with it or the subscription is dead again:
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.custody_events;
--   GRANT SELECT ON TABLE public.custody_events TO authenticated;
--
-- LOCK / SCALE: `ALTER PUBLICATION ... DROP TABLE` is a catalog change. It
-- takes a brief lock on the table, rewrites nothing and scans nothing.
--
-- Guarded twice, so a plain Postgres with no publication and a project where
-- this has already run are both no-ops.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publication supabase_realtime not found — nothing to remove (expected on plain Postgres).';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'custody_events'
  ) THEN
    RAISE NOTICE 'custody_events is not in supabase_realtime — already done.';
    RETURN;
  END IF;

  ALTER PUBLICATION supabase_realtime DROP TABLE public.custody_events;
END
$$;
