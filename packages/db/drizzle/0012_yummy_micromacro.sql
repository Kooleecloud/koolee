CREATE TABLE "slot_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"block_start" timestamp with time zone NOT NULL,
	"block_end" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_blocks_order_check" CHECK ("slot_blocks"."block_end" > "slot_blocks"."block_start")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pickup_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pickup_window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "lead_time_multipliers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "slot_blocks" ADD CONSTRAINT "slot_blocks_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_blocks" ADD CONSTRAINT "slot_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slot_blocks_airport_start_idx" ON "slot_blocks" USING btree ("airport_code","block_start");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickup_window_pair_check" CHECK (("bookings"."pickup_window_start" is null) = ("bookings"."pickup_window_end" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickup_window_order_check" CHECK ("bookings"."pickup_window_end" is null or "bookings"."pickup_window_end" > "bookings"."pickup_window_start");--> statement-breakpoint
-- Hand-authored backfill: legacy bookings referenced a slot row; copy its
-- window onto the booking so display and dispatch read one place. Idempotent.
UPDATE "bookings" b
SET "pickup_window_start" = s."window_start",
    "pickup_window_end" = s."window_end"
FROM "slots" s
WHERE b."slot_id" = s."id" AND b."pickup_window_start" IS NULL;