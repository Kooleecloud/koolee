CREATE TABLE "agent_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"zip" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_zones" ADD CONSTRAINT "agent_zones_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_zones_agent_zip_key" ON "agent_zones" USING btree ("agent_user_id","zip");--> statement-breakpoint
CREATE INDEX "agent_zones_zip_idx" ON "agent_zones" USING btree ("zip");