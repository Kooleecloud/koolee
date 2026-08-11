CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "capture_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_key" ON "payment_webhook_events" USING btree ("provider","event_id");