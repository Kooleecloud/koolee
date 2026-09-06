-- ---------------------------------------------------------------------------
-- 0032 — push_subscriptions: one row per (person, browser install).
--
-- WHAT THIS IS. The browser's half of a Web Push channel: an `endpoint` at the
-- vendor's push service (FCM / Mozilla autopush / APNs) plus the two keys the
-- payload is encrypted to. Koolee never talks to a device — it POSTs an
-- encrypted blob to that endpoint. Routing only; no message content is stored.
--
-- WHY THE UNIQUE INDEX IS ON `endpoint` ALONE, not (user_id, endpoint).
-- An endpoint identifies one browser install GLOBALLY. If a device changes
-- hands and the new person signs in, the row must MOVE to them rather than
-- duplicate — otherwise the previous owner keeps receiving notifications for
-- a booking that is no longer theirs. Subscribe is therefore an upsert on
-- `endpoint` that overwrites `user_id`, and this index is what makes that
-- possible. (u,e) would have allowed exactly the duplicate we must not have.
--
-- RLS. Nothing is done here on purpose, and that is not an omission. This
-- table is SERVER-ONLY: no browser client ever queries it (subscribe /
-- unsubscribe go through authenticated Server Actions on the pooled
-- connection). 0016's `ensure_rls` event trigger switches RLS on for any table
-- created in `public`, so this table lands with RLS ENABLED and ZERO POLICIES
-- — which denies `anon` and `authenticated` outright, the correct posture.
-- The §7 rule "an RLS policy grants nothing, so add the GRANT too" applies to
-- CLIENT-READABLE tables (0031, 0016); adding either here would be widening
-- access nothing needs.
--
-- LOCK / SCALE NOTES. A fresh CREATE TABLE plus two index builds on an empty
-- table: nothing to lock out, no rewrite, no scan. Safe on a live database.
-- ---------------------------------------------------------------------------

CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" varchar(120),
	"app" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");