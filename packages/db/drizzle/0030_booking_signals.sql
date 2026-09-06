CREATE TABLE "booking_signals" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"touched_by" uuid
);
--> statement-breakpoint
ALTER TABLE "booking_signals" ADD CONSTRAINT "booking_signals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_signals" ADD CONSTRAINT "booking_signals_touched_by_users_id_fk" FOREIGN KEY ("touched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_signals_updated_at_idx" ON "booking_signals" USING btree ("updated_at");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- CUSTOM ADDITIONS TO 0030 (hand-written below the generated DDL).
--
-- `booking_signals` is the REALTIME DOORBELL: one mutable row per booking
-- whose `updated_at` moves whenever anything about that booking changes. A
-- browser subscribes to it, learns that something happened, and then refetches
-- through the ordinary server path. The payload is NEVER rendered.
--
-- THE ARCHITECTURE RULE THIS ENCODES. Realtime needs RLS, and RLS on the real
-- domain tables would put a second authorization model beside the one in
-- `packages/core` — invisible to every test that runs on the direct
-- connection, which bypasses RLS entirely. So exactly ONE table is client-
-- readable, it carries three columns, and the worst a policy mistake here can
-- leak is that somebody else's booking changed at some instant. A spurious
-- signal costs a refetch; a missed one degrades to the polling fallback the
-- client already has.
--
-- 1. THE TRIGGER, and why it is a trigger.
--
-- Every custody event touches the signal. There are ~20 `insert(custody_events)`
-- call sites across the services and no choke point in core to hang this off —
-- and a list of call sites that must each remember to do something is exactly
-- how six of seven exception paths went silent for a whole slice (see
-- events/booking-events.ts). An AFTER INSERT trigger is covered by
-- CONSTRUCTION: a service added tomorrow that appends a custody event signals
-- correctly without knowing this table exists.
--
-- The one writer that appends NO custody event is the driver's GPS ping —
-- deliberately, because a position is not evidence. That path calls
-- `touchBookingSignal` in core instead.
--
-- Nothing time-based signals: "running late" and "missed cutoff" are computed
-- from the clock by `services/actionability.ts` and nothing is written when
-- they become true. The client's polling fallback is what surfaces those, and
-- that is the honest mechanism for a state change nobody performs.
--
-- 2. THE POLICY, and the SECURITY DEFINER function it needs.
--
-- ONE policy, SELECT only. Every write reaches this table over the
-- direct/service-role connection, which bypasses RLS.
--
-- The check cannot be an inline `EXISTS (... verification_tasks ...)`: RLS is
-- on for every table in `public` (0016) and the task tables carry no policies,
-- so the subquery would evaluate as `authenticated`, return zero rows, and the
-- staff half of this policy would silently never match. That is the same shape
-- as the storage bug fixed twice already (0008 -> 0009, 0022 -> 0023). It goes
-- in a SECURITY DEFINER function, exactly like `public.is_active_staff`.
--
-- 3. REPLICA IDENTITY FULL + the publication.
--
-- Supabase requires both before `postgres_changes` delivers anything. Guarded
-- so a plain Postgres 16 (docker-compose, CI) still migrates cleanly.
-- ---------------------------------------------------------------------------

INSERT INTO public.booking_signals (booking_id, updated_at)
SELECT b.id, b.updated_at FROM public.bookings b
ON CONFLICT (booking_id) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.touch_booking_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.booking_signals (booking_id, updated_at, touched_by)
  VALUES (NEW.booking_id, now(), NEW.actor_user_id)
  ON CONFLICT (booking_id) DO UPDATE
    SET updated_at = now(),
        touched_by = EXCLUDED.touched_by;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS custody_events_touch_signal ON public.custody_events;
--> statement-breakpoint

CREATE TRIGGER custody_events_touch_signal
  AFTER INSERT ON public.custody_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_signal();
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR to_regprocedure('auth.uid()') IS NULL
  THEN
    RAISE NOTICE 'Supabase auth not detected - skipping booking_signals RLS (expected on local Postgres). Realtime is a signal only; authorization lives in packages/core regardless.';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.can_watch_booking(uid uuid, booking uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
    AS $body$
      SELECT
        uid IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.id = booking AND b.user_id = uid
          )
          OR (
            public.is_active_staff(uid)
            AND (
              EXISTS (
                SELECT 1 FROM public.verification_tasks vt
                WHERE vt.booking_id = booking AND vt.assignee_user_id = uid
              )
              OR EXISTS (
                SELECT 1 FROM public.pickup_tasks pt
                WHERE pt.booking_id = booking AND pt.assignee_user_id = uid
              )
            )
          )
        )
    $body$
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.can_watch_booking(uuid, uuid) FROM public';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.can_watch_booking(uuid, uuid) TO authenticated';

  EXECUTE 'ALTER TABLE public.booking_signals ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "booking_signals_select_watchable" ON public.booking_signals';
  EXECUTE $pol$
    CREATE POLICY "booking_signals_select_watchable"
      ON public.booking_signals
      FOR SELECT
      TO authenticated
      USING (public.can_watch_booking(auth.uid(), booking_id))
  $pol$;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER TABLE public.booking_signals REPLICA IDENTITY FULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'booking_signals'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_signals;
    END IF;
  ELSE
    RAISE NOTICE 'publication supabase_realtime not found - skipping Realtime setup (expected on local Postgres)';
  END IF;
END
$$;
