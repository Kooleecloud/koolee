-- ---------------------------------------------------------------------------
-- 0031 — the GRANT that 0030's RLS policy is useless without.
--
-- WHAT WENT WRONG. 0030 enabled RLS on `booking_signals` and wrote one SELECT
-- policy, and every part of it was correct: the policy is right, the SECURITY
-- DEFINER function is right, the table is in the `supabase_realtime`
-- publication with REPLICA IDENTITY FULL. And no browser ever received a
-- single change event.
--
-- A POLICY DOES NOT GRANT ANYTHING. Row-level security NARROWS what a role may
-- already read; it cannot widen it. `authenticated` held only
-- REFERENCES/TRIGGER/TRUNCATE on this table — no SELECT — so Realtime's
-- per-row authorization check failed before the policy was ever consulted,
-- and it failed the way this class of bug always fails: silently, with zero
-- rows and no error, indistinguishable from "nothing has changed".
--
-- Found by driving two browsers side by side, not by any test in this repo:
-- the integration tier runs on the direct connection, where RLS and GRANTs are
-- both irrelevant. Same blind spot as the storage-policy bugs 0009 and 0023
-- had to fix, in a new place.
--
-- WHY IT IS EXPLICIT RATHER THAN INHERITED. Supabase's default privileges
-- normally grant `anon`/`authenticated` on new tables in `public`, and
-- PROJECT-STATUS §3.1 records 154 such grants per role — measured on HOSTED.
-- The local stack does not have them. That is exactly the local-vs-hosted
-- divergence 0016 exists to stop repeating, so this states the grant instead
-- of hoping an environment supplies it. Idempotent, and safe on a project that
-- already has it.
--
-- `authenticated` ONLY, never `anon`. A signed-out session has no `auth.uid()`
-- and the policy refuses it anyway (`uid IS NOT NULL`), but a grant nobody
-- needs is a grant somebody eventually leans on.
--
-- SELECT ONLY. Every write reaches this table over the direct/service-role
-- connection. There is no client write path and there must not be one.
--
-- NOTE ON `custody_events`: it has carried the same shape since 0001 — RLS on,
-- two policies, in the publication, no SELECT grant — so its subscription has
-- never been able to deliver either. Nothing subscribes to it (the customer
-- timeline is server-rendered), so this migration deliberately does NOT widen
-- it. Opening a table nobody reads from a browser would be a privilege change
-- with no feature behind it. Recorded here so the next person does not have to
-- rediscover it.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'role authenticated not present — skipping grant (expected on plain Postgres).';
    RETURN;
  END IF;

  EXECUTE 'GRANT SELECT ON TABLE public.booking_signals TO authenticated';
END
$$;
