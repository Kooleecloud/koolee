CREATE TABLE "driver_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"device_label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "driver_push_tokens" ADD CONSTRAINT "driver_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_push_tokens_token_key" ON "driver_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "driver_push_tokens_user_idx" ON "driver_push_tokens" USING btree ("user_id");
--> statement-breakpoint
-- ============================================================================
-- CUSTOM ADDITIONS (hand-written; drizzle-kit cannot infer these)
-- ============================================================================
-- Server-only table (see the schema comment): RLS on explicitly rather than
-- via the `ensure_rls` event trigger, which does not exist on a hosted project
-- whose `postgres` role is not a superuser. No policy, no grant.
ALTER TABLE "public"."driver_push_tokens" ENABLE ROW LEVEL SECURITY;
