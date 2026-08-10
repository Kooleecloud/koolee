CREATE TYPE "public"."ticket_extraction_status" AS ENUM('pending', 'extracted', 'unreadable', 'failed');--> statement-breakpoint
CREATE TABLE "ticket_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"extraction_status" "ticket_extraction_status" DEFAULT 'pending' NOT NULL,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_uploads_size_positive_check" CHECK ("ticket_uploads"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "ticket_uploads" ADD CONSTRAINT "ticket_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_uploads_draft_id_idx" ON "ticket_uploads" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "ticket_uploads_user_id_idx" ON "ticket_uploads" USING btree ("user_id");