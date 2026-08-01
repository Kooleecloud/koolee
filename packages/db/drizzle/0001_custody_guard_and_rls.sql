-- ---------------------------------------------------------------------------
-- 0001 — custody append-only guard, RLS for client-side reads, Realtime.
--
-- Three concerns in one migration because they are meaningless apart: the
-- guard protects the custody log, RLS lets a customer's browser subscribe to
-- their own slice of it, and the publication is what makes the subscription
-- deliver anything.
--
-- AUTHORIZATION MODEL (see README.md):
--   Application reads and writes go through Drizzle on a direct/service-role
--   connection, which BYPASSES RLS. Authorization for those paths is enforced
--   in packages/core. The policies below exist solely to constrain the
--   anon/authenticated roles used by client-side supabase-js for Realtime
--   subscriptions and Storage. Do not treat them as the primary control.
--
-- Runs on the DIRECT connection (port 5432) via `pnpm db:migrate`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. custody_events is append-only.
--
-- The data-access layer exposes no update/delete helper, but that is a
-- convention. This is the enforcement: it holds against psql, against a
-- service-role client, and against a future contributor who has not read the
-- README. Corrections are made by appending a compensating event.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custody_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'custody_events is append-only: % is not permitted on this table. Append a compensating event instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS custody_events_no_update ON public.custody_events;
--> statement-breakpoint

CREATE TRIGGER custody_events_no_update
  BEFORE UPDATE ON public.custody_events
  FOR EACH ROW EXECUTE FUNCTION public.custody_events_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS custody_events_no_delete ON public.custody_events;
--> statement-breakpoint

CREATE TRIGGER custody_events_no_delete
  BEFORE DELETE ON public.custody_events
  FOR EACH ROW EXECUTE FUNCTION public.custody_events_append_only();
--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers, so it needs a statement-level one.
DROP TRIGGER IF EXISTS custody_events_no_truncate ON public.custody_events;
--> statement-breakpoint

CREATE TRIGGER custody_events_no_truncate
  BEFORE TRUNCATE ON public.custody_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.custody_events_append_only();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. RLS — ONLY for the two tables a customer's browser subscribes to.
--
-- Deliberately narrow. Every other table has RLS left off because no client
-- ever touches it directly; adding policies there would imply a guarantee the
-- architecture does not make.
--
-- Gated on Supabase being present. `auth.uid()` and the `authenticated` role
-- do not exist on a plain Postgres 16 (docker-compose, CI), and CREATE POLICY
-- validates both at creation time — ungated, this migration would be
-- unrunnable locally.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR to_regprocedure('auth.uid()') IS NULL
  THEN
    RAISE NOTICE 'Supabase auth not detected — skipping RLS policies (expected on local Postgres). Application authorization lives in packages/core regardless.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.custody_events ENABLE ROW LEVEL SECURITY';

  -- A customer may read their own bookings. SELECT only: every mutation goes
  -- through packages/core on a service-role connection.
  EXECUTE 'DROP POLICY IF EXISTS "bookings_select_own" ON public.bookings';
  EXECUTE $pol$
    CREATE POLICY "bookings_select_own"
      ON public.bookings
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id)
  $pol$;

  -- A customer may read custody events for their own bookings — this is what
  -- powers the live timeline on /trips/[bookingId].
  EXECUTE 'DROP POLICY IF EXISTS "custody_events_select_own" ON public.custody_events';
  EXECUTE $pol$
    CREATE POLICY "custody_events_select_own"
      ON public.custody_events
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.id = custody_events.booking_id
            AND b.user_id = auth.uid()
        )
      )
  $pol$;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. Realtime publication.
--
-- Guarded so a plain Postgres 16 (docker-compose, CI) that has neither the
-- `supabase_realtime` publication nor an `auth` schema still migrates cleanly.
-- REPLICA IDENTITY FULL is required by Supabase before a table can be added.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER TABLE public.custody_events REPLICA IDENTITY FULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'custody_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.custody_events;
    END IF;
  ELSE
    RAISE NOTICE 'publication supabase_realtime not found — skipping Realtime setup (expected on local Postgres)';
  END IF;
END
$$;
