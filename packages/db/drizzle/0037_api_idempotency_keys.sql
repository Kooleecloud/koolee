CREATE TABLE "api_idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "api_idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_created_at_idx" ON "api_idempotency_keys" USING btree ("created_at");
--> statement-breakpoint
-- ============================================================================
-- CUSTOM ADDITIONS (hand-written; drizzle-kit cannot infer these)
-- ============================================================================
-- Server-only table: read and written through core on the pooled connection,
-- never by a browser or the native app. RLS is enabled explicitly rather than
-- left to the `ensure_rls` event trigger, which does not exist on a hosted
-- project whose `postgres` role is not a superuser (see 0016, and the 0032 /
-- 0036 omission recorded in docs/MIGRATIONS.md). No policy, no grant: deny
-- for anon and authenticated.
ALTER TABLE "public"."api_idempotency_keys" ENABLE ROW LEVEL SECURITY;
