-- ---------------------------------------------------------------------------
-- 0018 — waitlist_signups: persist coverage-expansion waitlist signups.
--
-- WHY THIS EXISTS
--
-- Both email-capture surfaces (the /waitlist page and the booking funnel's
-- out-of-area fork) were deliberate stubs: they validated, console.logged and
-- returned success — every address a real visitor left was dropped on the
-- floor. This table is where they land now.
--
-- One row per (email, zip) PAIR, unique together: the fact recorded is "this
-- person wants service in this zone", so one email may hold several ZIPs and
-- per-zone demand counts (GROUP BY zip) stay honest. Email is stored
-- lowercased by the writing service, making the pair case-insensitive.
-- `notified_at` is the landing pad for the future "your zone opened" email
-- (Resend) — stamped on send, so the notify job is idempotent by query.
--
-- Deliberately NOT stored: zip-covered / email-has-account flags. Both are
-- live questions answered at read time; snapshots go stale exactly when the
-- notify flow would trust them.
--
-- RISK: none to existing data — new enum + new empty table, no locks taken on
-- anything live, reversible with DROP TABLE + DROP TYPE. RLS is auto-enabled
-- by the `ensure_rls` event trigger (0016); app access stays on the direct
-- connection via @koolee/core, so no policies are needed.
-- ---------------------------------------------------------------------------

CREATE TYPE "public"."waitlist_source" AS ENUM('waitlist_page', 'booking_out_of_area');--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"zip" text NOT NULL,
	"source" "waitlist_source" NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_zip_key" ON "waitlist_signups" USING btree ("email","zip");--> statement-breakpoint
CREATE INDEX "waitlist_signups_zip_idx" ON "waitlist_signups" USING btree ("zip");