-- ---------------------------------------------------------------------------
-- 0039 — the admin live map: driver_positions + driver_shifts over Realtime.
--
-- WHAT THIS IS. The ops console gets a map of every driver on shift, moving
-- as the native app reports (every 5 s). The browser subscribes to
-- `driver_positions` changes with one `staff_user_id=eq.<id>` filter per open
-- shift (never unfiltered — an unfiltered subscription on an RLS table
-- returns CHANNEL_ERROR), and to `driver_shifts` so a shift opening or
-- closing refreshes the roster.
--
-- FOUR THINGS, ALL FOUR OR NOTHING (0030 + 0031 precedent):
--   1. REPLICA IDENTITY FULL — Realtime needs the whole row to evaluate RLS.
--   2. Publication membership — otherwise no events are emitted at all.
--   3. A SELECT policy for `authenticated` — ADMINS ONLY, through a
--      SECURITY DEFINER check on staff_members, because RLS is evaluated
--      against the browser's own session and a driver's browser must not be
--      able to watch every other driver.
--   4. GRANT SELECT to `authenticated` — a policy grants nothing by itself;
--      without this the subscription silently delivers zero rows (0031).
--
-- WHO IS ADMITTED. `public.is_active_admin(uid)`: an ACTIVE staff_members row
-- with role = 'admin'. Agents are not admitted; the native app reads its own
-- position from the pin it just sent, not from here.
--
-- WHAT THIS DOES NOT CHANGE. Server-side reads still run on the pooled
-- `postgres` connection through @koolee/core and bypass RLS; the policy is
-- for the browser's Realtime socket only.
--
-- LOCK / SCALE NOTES. `ALTER TABLE … REPLICA IDENTITY FULL` takes a brief
-- ACCESS EXCLUSIVE lock on two small tables (one row per driver; one row per
-- shift) and rewrites nothing. Policies, grants and publication membership
-- are catalog-only. Reversible: DROP POLICY, REVOKE, ALTER PUBLICATION … DROP
-- TABLE, REPLICA IDENTITY DEFAULT. Guarded so plain Postgres (CI) skips it.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR to_regprocedure('auth.uid()') IS NULL
  THEN
    RAISE NOTICE 'Supabase auth not detected - skipping admin driver Realtime RLS (expected on local Postgres).';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.is_active_admin(uid uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
    AS $body$
      SELECT uid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.staff_members s
        WHERE s.user_id = uid AND s.active AND s.role = 'admin'
      )
    $body$
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM public';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO authenticated';

  EXECUTE 'ALTER TABLE public.driver_positions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "driver_positions_admin_select" ON public.driver_positions';
  EXECUTE $pol$
    CREATE POLICY "driver_positions_admin_select"
      ON public.driver_positions
      FOR SELECT
      TO authenticated
      USING (public.is_active_admin(auth.uid()))
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "driver_shifts_admin_select" ON public.driver_shifts';
  EXECUTE $pol$
    CREATE POLICY "driver_shifts_admin_select"
      ON public.driver_shifts
      FOR SELECT
      TO authenticated
      USING (public.is_active_admin(auth.uid()))
  $pol$;

  -- A policy grants nothing (0031). SELECT only, authenticated only, never anon.
  EXECUTE 'GRANT SELECT ON TABLE public.driver_positions TO authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.driver_shifts TO authenticated';
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER TABLE public.driver_positions REPLICA IDENTITY FULL;
    ALTER TABLE public.driver_shifts REPLICA IDENTITY FULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_positions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_positions;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_shifts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_shifts;
    END IF;
  ELSE
    RAISE NOTICE 'publication supabase_realtime not found - skipping Realtime setup (expected on local Postgres)';
  END IF;
END
$$;
