CREATE TYPE "public"."booking_status" AS ENUM('draft', 'paid', 'agent_assigned', 'verified_sealed', 'awaiting_pickup', 'in_transit', 'delivered_to_bagdrop', 'completed', 'exception', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cutoff_scope" AS ENUM('domestic', 'international');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('authorized', 'captured', 'refunded', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."slot_tier" AS ENUM('standard_4h', 'express_2h', 'priority_1h');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'assigned', 'in_progress', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'agent', 'driver', 'admin');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state" varchar(2) NOT NULL,
	"zip" varchar(10) NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"place_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" varchar(20),
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_color" text,
	"vehicle_plate" varchar(16),
	"vehicle_capacity_bags" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(320),
	"full_name" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airline_cutoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airline_iata" varchar(3) NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"scope" "cutoff_scope" NOT NULL,
	"cutoff_minutes_before_departure" integer NOT NULL,
	"source" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airports" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tz" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airports_code_check" CHECK ("airports"."code" in ('JFK', 'LGA', 'EWR'))
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"tier" "slot_tier" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_capacity_nonneg_check" CHECK ("slots"."capacity" >= 0),
	CONSTRAINT "slots_booked_within_capacity_check" CHECK ("slots"."booked_count" >= 0 and "slots"."booked_count" <= "slots"."capacity"),
	CONSTRAINT "slots_window_order_check" CHECK ("slots"."window_end" > "slots"."window_start")
);
--> statement-breakpoint
CREATE TABLE "bags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"seal_id" text,
	"weight_kg" numeric(6, 2),
	"photo_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'draft' NOT NULL,
	"flight_number" varchar(10) NOT NULL,
	"airline_iata" varchar(3) NOT NULL,
	"departure_airport" varchar(3) NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"pax_name" text NOT NULL,
	"pickup_address_id" uuid NOT NULL,
	"bag_count" integer NOT NULL,
	"slot_id" uuid,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_bag_count_positive_check" CHECK ("bookings"."bag_count" > 0),
	CONSTRAINT "bookings_price_nonneg_check" CHECK ("bookings"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"bag_id" uuid,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"event_type" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"photo_url" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"date" date NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"status" "route_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_nonneg_check" CHECK ("payments"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_fee_cents" integer NOT NULL,
	"per_bag_cents" integer NOT NULL,
	"distance_multiplier" numeric(8, 4) NOT NULL,
	"slot_tier_multiplier" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_base_fee_nonneg_check" CHECK ("pricing_rules"."base_fee_cents" >= 0),
	CONSTRAINT "pricing_rules_per_bag_nonneg_check" CHECK ("pricing_rules"."per_bag_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airline_cutoffs" ADD CONSTRAINT "airline_cutoffs_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bags" ADD CONSTRAINT "bags_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_airport_airports_code_fk" FOREIGN KEY ("departure_airport") REFERENCES "public"."airports"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickup_address_id_addresses_id_fk" FOREIGN KEY ("pickup_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_bag_id_bags_id_fk" FOREIGN KEY ("bag_id") REFERENCES "public"."bags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_tasks" ADD CONSTRAINT "pickup_tasks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_tasks" ADD CONSTRAINT "pickup_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tasks" ADD CONSTRAINT "verification_tasks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tasks" ADD CONSTRAINT "verification_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_id_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "addresses_zip_idx" ON "addresses" USING btree ("zip");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_id_key" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agents_active_idx" ON "agents" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drivers_active_idx" ON "drivers" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "airline_cutoffs_airline_airport_scope_key" ON "airline_cutoffs" USING btree ("airline_iata","airport_code","scope");--> statement-breakpoint
CREATE INDEX "airline_cutoffs_airport_idx" ON "airline_cutoffs" USING btree ("airport_code");--> statement-breakpoint
CREATE INDEX "slots_airport_window_idx" ON "slots" USING btree ("airport_code","window_start");--> statement-breakpoint
CREATE INDEX "slots_window_start_idx" ON "slots" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "bags_booking_id_idx" ON "bags" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bags_seal_id_idx" ON "bags" USING btree ("seal_id");--> statement-breakpoint
CREATE INDEX "bookings_user_id_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_departure_at_idx" ON "bookings" USING btree ("departure_at");--> statement-breakpoint
CREATE INDEX "bookings_slot_id_idx" ON "bookings" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "bookings_status_departure_idx" ON "bookings" USING btree ("status","departure_at");--> statement-breakpoint
CREATE INDEX "custody_events_booking_created_idx" ON "custody_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "custody_events_bag_id_idx" ON "custody_events" USING btree ("bag_id");--> statement-breakpoint
CREATE INDEX "custody_events_event_type_idx" ON "custody_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "pickup_tasks_booking_id_idx" ON "pickup_tasks" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "pickup_tasks_assignee_status_idx" ON "pickup_tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "pickup_tasks_scheduled_start_idx" ON "pickup_tasks" USING btree ("scheduled_start");--> statement-breakpoint
CREATE INDEX "verification_tasks_booking_id_idx" ON "verification_tasks" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "verification_tasks_assignee_status_idx" ON "verification_tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "verification_tasks_scheduled_start_idx" ON "verification_tasks" USING btree ("scheduled_start");--> statement-breakpoint
CREATE INDEX "routes_driver_date_idx" ON "routes" USING btree ("driver_id","date");--> statement-breakpoint
CREATE INDEX "routes_date_airport_idx" ON "routes" USING btree ("date","airport_code");--> statement-breakpoint
CREATE INDEX "routes_status_idx" ON "routes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payments_booking_id_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pricing_rules_active_effective_idx" ON "pricing_rules" USING btree ("active","effective_from");