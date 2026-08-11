-- ---------------------------------------------------------------------------
-- 0016 — uniform RLS baseline across every environment.
--
-- WHY THIS EXISTS
--
-- The hosted project already looks like this. Someone applied it out-of-band
-- (it has the shape of a Supabase security-advisor remediation): an
-- `ensure_rls` event trigger calling `public.rls_auto_enable()`, plus RLS
-- switched on for every table in `public`. None of it was ever in this repo, so
-- local, CI and any future staging project did NOT have it — hosted and local
-- had genuinely different security postures, and the difference ran the WRONG
-- way round:
--
--   * On hosted, 20 tables had RLS on with ZERO policies. `anon` and
--     `authenticated` hold blanket table GRANTs (154 privilege rows each), so
--     the only thing standing between those roles and, say, `otp_send_log` or
--     `staff_members` was the empty-policy deny.
--   * On local those same 20 tables had RLS OFF, so the deny did not exist and
--     local was the LESS safe environment. Nothing in the test suite could
--     catch a client-side read that hosted would refuse.
--
-- Two failure modes follow from that split, and this migration closes both:
--
--   1. A feature that reaches an app table through the browser supabase-js
--      client instead of core's direct connection works perfectly locally and
--      silently returns zero rows on hosted. Deploy-only bug, invisible to the
--      local stack.
--   2. The protection was accidental. Written down, it becomes a decision.
--
-- WHAT THIS DOES NOT CHANGE
--
-- The authorization model is untouched (see 0001 and README): application reads
-- and writes go through Drizzle on the direct/service-role connection, whose
-- role carries `rolbypassrls`, so RLS is not consulted on those paths and
-- authorization stays in `packages/core`. Enabling RLS here therefore has NO
-- effect on application behaviour — verified: `postgres` reports
-- `rolsuper=false, rolbypassrls=true`, and no table uses FORCE ROW LEVEL
-- SECURITY, so even the owner path is unaffected.
--
-- The two tables that DO carry policies (`bookings`, `custody_events`, set up
-- in 0001 for Realtime) keep exactly the policies they have. This migration
-- adds no policy to anything.
--
-- LOCK / SCALE NOTES
--
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is a catalog flag flip: it takes
-- a brief ACCESS EXCLUSIVE lock, rewrites no rows, and scans nothing. It is
-- O(1) per table regardless of table size, and idempotent — re-enabling an
-- already-enabled table is a no-op. Safe on a live database.
--
-- IDEMPOTENCE
--
-- Written to be a no-op against hosted, which is already in the target state.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. RLS on for every base table in `public`.
--
-- A loop over the catalog rather than a hand-written list of 22 names, for the
-- same reason `rls_auto_enable` uses one: a literal list goes stale the moment
-- someone adds a table, and a migration that silently covers 22 of 23 tables is
-- worse than no migration at all. This mirrors the event trigger's own logic so
-- the two can never disagree.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t record;
  enabled_count int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')          -- ordinary + partitioned tables
      AND NOT c.relrowsecurity             -- already on ⇒ nothing to do
      AND c.relname <> '__koolee_test_database'  -- test-DB marker, not schema
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    enabled_count := enabled_count + 1;
    RAISE NOTICE 'RLS enabled on public.%', t.relname;
  END LOOP;

  RAISE NOTICE 'RLS baseline: % table(s) changed (0 means already in the target state)', enabled_count;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. Keep it true for tables added later.
--
-- `rls_auto_enable()` is copied verbatim from the hosted project so the two
-- definitions are identical rather than merely similar. SECURITY DEFINER with a
-- pinned `search_path` is what makes it safe to run on arbitrary DDL.
--
-- The function is created unconditionally (CREATE OR REPLACE is idempotent).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. The event trigger itself — best-effort, and deliberately so.
--
-- `CREATE EVENT TRIGGER` requires superuser. Supabase's `postgres` role is NOT
-- superuser (`rolsuper=false`), so this statement CANNOT succeed on a fresh
-- Supabase project via `pnpm db:migrate`. On the current hosted project the
-- trigger already exists, so the guard below skips it and this is a no-op; on
-- the local stack `postgres` IS superuser, so it is created.
--
-- It is therefore wrapped in an exception handler rather than allowed to abort
-- the transaction. Step 1 is the load-bearing part and has already run
-- unconditionally; losing the auto-enable convenience on a locked-down project
-- must not block a deploy, and failing loudly-but-fatally here would mean a
-- fresh staging project could never migrate at all.
--
-- The warning is not decorative: if it fires, tables created by LATER
-- migrations on that database will not get RLS automatically, and something has
-- to re-run step 1. `pnpm db:status` asserts this, so the gap surfaces as a
-- failed check rather than as a surprise.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    RAISE NOTICE 'event trigger ensure_rls already present — leaving it alone';
  ELSE
    BEGIN
      CREATE EVENT TRIGGER ensure_rls
        ON ddl_command_end
        EXECUTE FUNCTION public.rls_auto_enable();
      RAISE NOTICE 'event trigger ensure_rls created';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE WARNING
          'could not create event trigger ensure_rls (needs superuser). RLS is still enabled on all CURRENT tables, but tables added by future migrations on this database will NOT get it automatically — re-run this migration''s step 1, or have the platform owner create the trigger.';
    END;
  END IF;
END
$$;
