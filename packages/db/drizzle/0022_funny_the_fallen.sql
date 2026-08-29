CREATE TYPE "public"."passport_validity_check_status" AS ENUM('not_checked', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."passport_verification_status" AS ENUM('pending', 'customer_uploaded', 'agent_confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"agreement_version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by_user_id" uuid NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "passport_verification_status" DEFAULT 'pending' NOT NULL,
	"photo_storage_path" text,
	"uploaded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_agent_id" uuid,
	"validity_check_status" "passport_validity_check_status" DEFAULT 'not_checked' NOT NULL,
	"validity_check_provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_agreement_version_id_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."agreement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_verifications" ADD CONSTRAINT "passport_verifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_verifications" ADD CONSTRAINT "passport_verifications_confirmed_by_agent_id_users_id_fk" FOREIGN KEY ("confirmed_by_agent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_acceptances_booking_version_key" ON "agreement_acceptances" USING btree ("booking_id","agreement_version_id");--> statement-breakpoint
CREATE INDEX "agreement_acceptances_booking_id_idx" ON "agreement_acceptances" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_versions_version_key" ON "agreement_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "agreement_versions_effective_from_idx" ON "agreement_versions" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_verifications_booking_id_key" ON "passport_verifications" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "passport_verifications_status_idx" ON "passport_verifications" USING btree ("status");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- CUSTOM ADDITIONS TO 0022 (hand-written below the generated DDL).
--
-- Drizzle infers tables, columns, indexes and FKs. It cannot infer triggers,
-- RLS, or storage buckets, so the three things that make these tables
-- trustworthy are written out here.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. agreement_acceptances is APPEND-ONLY.
--
-- Same guarantee, same mechanism, and for the same reason as `custody_events`
-- (migration 0001): this row is evidence that a named person agreed to
-- specific terms at a specific instant. The data-access layer exposing no
-- update/delete helper is a convention; this is the enforcement, and it holds
-- against psql, against a service-role client, and against a future
-- contributor who has not read the schema comment.
--
-- There is no "correcting" an acceptance. A change of terms is a NEW
-- `agreement_versions` row and a new acceptance against it — which is exactly
-- what the derived-current model already makes the only possible move.
--
-- A separate function rather than reusing `custody_events_append_only()`: the
-- message is the point. An operator who hits this needs to be told the way
-- FORWARD for *this* table (publish a new version, record a new acceptance),
-- which is different advice from custody's "append a compensating event".
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agreement_acceptances_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'agreement_acceptances is append-only: % is not permitted on this table. Publish a new agreement version and record a new acceptance instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS agreement_acceptances_no_update ON public.agreement_acceptances;
--> statement-breakpoint

CREATE TRIGGER agreement_acceptances_no_update
  BEFORE UPDATE ON public.agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.agreement_acceptances_append_only();
--> statement-breakpoint

DROP TRIGGER IF EXISTS agreement_acceptances_no_delete ON public.agreement_acceptances;
--> statement-breakpoint

CREATE TRIGGER agreement_acceptances_no_delete
  BEFORE DELETE ON public.agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.agreement_acceptances_append_only();
--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers, so it needs a statement-level one.
DROP TRIGGER IF EXISTS agreement_acceptances_no_truncate ON public.agreement_acceptances;
--> statement-breakpoint

CREATE TRIGGER agreement_acceptances_no_truncate
  BEFORE TRUNCATE ON public.agreement_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION public.agreement_acceptances_append_only();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. RLS baseline for the three new tables.
--
-- Migration 0016 promises RLS is ON for every table in `public`, and
-- `pnpm db:status` asserts it. Where the `ensure_rls` event trigger exists it
-- has already done this by the time we get here (it fires on
-- ddl_command_end); where it does not — any project whose `postgres` role
-- lacks superuser, which 0016 says is the normal Supabase case — nothing
-- would have. Enabling an already-enabled table is a no-op, so this is
-- idempotent either way and the baseline holds on every environment.
--
-- No policy is added. These tables are reached only through `@koolee/core` on
-- the direct connection (which bypasses RLS), so the empty-policy deny is the
-- correct posture for `anon`/`authenticated` — a policy here would imply a
-- client-side access path that does not exist.
-- ---------------------------------------------------------------------------

ALTER TABLE public.agreement_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agreement_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.passport_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. The PRIVATE `passport-photos` bucket, and who may write to it.
--
-- Modelled on `bag-photos` (0008) rather than on `ticket-uploads`, because
-- this bucket has the same writer profile as bag-photos and not as tickets:
-- the AGENT app uploads to it (an at-the-door capture), and that app
-- deliberately holds no service-role key — least privilege for a shared,
-- frequently-lost device. Its uploads therefore run as the signed-in agent
-- over the anon key, which leaves storage RLS as the only authorization
-- mechanism available. `ticket-uploads` is created lazily by a route holding
-- the service key, and that pattern simply cannot gate the agent.
--
-- The customer's pre-upload path goes through the web app's service-role
-- client (like ticket uploads), which bypasses these policies; it is gated in
-- `@koolee/core` by booking ownership instead.
--
-- Reads are signed-URL only — the bucket is private and there is no public
-- URL to a passport photo, ever. The SELECT policy is what lets a staff
-- session mint those short-TTL signed URLs.
--
-- Guarded on `storage.buckets` existing so a plain Postgres (docker-compose,
-- CI) still migrates cleanly — 0008 predates that guard and only runs where
-- Supabase Storage is installed.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not detected — skipping passport-photos bucket (expected on plain Postgres). Create it manually on any environment that serves uploads.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('passport-photos', 'passport-photos', false)
  ON CONFLICT (id) DO NOTHING;

  EXECUTE 'DROP POLICY IF EXISTS "passport_photos_staff_insert" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "passport_photos_staff_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'passport-photos'
      AND EXISTS (
        SELECT 1 FROM public.staff_members sm
        WHERE sm.user_id = auth.uid() AND sm.active
      )
    )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "passport_photos_staff_read" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "passport_photos_staff_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'passport-photos'
      AND EXISTS (
        SELECT 1 FROM public.staff_members sm
        WHERE sm.user_id = auth.uid() AND sm.active
      )
    )
  $pol$;
END
$$;
