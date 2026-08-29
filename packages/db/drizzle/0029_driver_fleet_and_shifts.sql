-- ---------------------------------------------------------------------------
-- 0029 — the driver model: trucks, shifts, positions; and the removal of the
-- scaffolding that pretended to be one.
--
-- WHY THIS EXISTS
--
-- Three tables shipped in 0000 and were never used by anything: `drivers`,
-- `routes` and `agents`. Zero rows in every environment, and — verified by
-- repo-wide grep immediately before writing this migration — zero reads and
-- zero writes anywhere outside `schema/` and `relations.ts`. `routes` never
-- even got a route-to-booking link, so a route could not be associated with a
-- pickup at all. Leaving them would have meant two homes for one fact the
-- moment `trucks` landed: a plate on the dispatch board and a plate on the
-- driver record, free to diverge.
--
-- WHAT REPLACES THEM
--
--   trucks           a vehicle and how many bags fit in it
--   driver_shifts    one person, in one truck, for one stretch of time
--   driver_positions where a driver was, last time their phone said anything
--
-- Plus two columns on existing tables:
--   staff_members.can_drive     DRIVING IS A CAPABILITY, NOT A THIRD ROLE.
--                               The `user_role` enum has carried `driver`
--                               since 0000 and the CHECK still excludes it, on
--                               purpose: one person doing both jobs is the v1
--                               reality, and a third role would force every
--                               authorization site to reason about somebody
--                               who is an agent on Tuesday and a driver on
--                               Thursday.
--   pickup_tasks.driver_shift_id  the real assignment target. A pickup belongs
--                               to a truck-with-a-person-in-it, which is what
--                               makes "you cannot clock off, there are bags in
--                               your van" a query rather than a convention.
--                               `assignee_user_id` stays, written in the same
--                               statement, because six existing readers key on
--                               it.
--
-- WHAT IS NOT HERE
--
-- No route entity, and no route optimisation: Koolee does not plan routes, a
-- customer picks a driver. No `reserved_spaces` enforcement — the column is
-- created and nothing reads it (`ops.ts` says so, and the admin UI labels it).
-- No agent-shift tracking: `driver_shifts` is for drivers only, and the
-- auto-assign that places agents stays deliberately shift-blind (see the note
-- at its call site).
--
-- ORDER MATTERS. Creations come first so `pickup_tasks.driver_shift_id` has a
-- table to reference. The drops come last, in FK order — routes → drivers →
-- agents — so no `CASCADE` is needed anywhere. `CASCADE` is avoided
-- deliberately: it would silently take dependents with it, and the entire
-- claim being made here is that there are none.
--
-- LOCKS / BLAST RADIUS, per group:
--   1. Three CREATE TABLEs + their indexes — new relations, nothing to block.
--   2. ENABLE ROW LEVEL SECURITY x3 — catalog flag flips, per 0016/0022.
--   3. staff_members.can_drive — ADD COLUMN with a NON-VOLATILE default, which
--      is catalog-only in PG11+ (no rewrite). 11 rows regardless.
--   4. pickup_tasks.driver_shift_id — nullable ADD COLUMN, catalog-only, plus
--      one FK (ACCESS EXCLUSIVE briefly, validating 14 rows) and one index.
--   5. The guard — a SELECT. RAISEs and aborts the whole migration if any of
--      the three tables has grown a row since this was written. Deliberately
--      fail-closed: a row means somebody started using a table this migration
--      is about to delete.
--   6. DROP TABLE x3 + DROP TYPE route_status — ACCESS EXCLUSIVE on tables
--      nothing references and nothing queries.
-- ---------------------------------------------------------------------------

CREATE TABLE "driver_positions" (
	"staff_user_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_positions_lat_range_check" CHECK ("driver_positions"."lat" between -90 and 90),
	CONSTRAINT "driver_positions_lng_range_check" CHECK ("driver_positions"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "driver_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_shifts_time_order_check" CHECK ("driver_shifts"."ended_at" is null or "driver_shifts"."ended_at" >= "driver_shifts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bag_capacity" integer NOT NULL,
	"reserved_spaces" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_bag_capacity_positive_check" CHECK ("trucks"."bag_capacity" > 0),
	CONSTRAINT "trucks_reserved_spaces_nonneg_check" CHECK ("trucks"."reserved_spaces" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "can_drive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pickup_tasks" ADD COLUMN "driver_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "driver_positions" ADD CONSTRAINT "driver_positions_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_positions_recorded_at_idx" ON "driver_positions" USING btree ("recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_shifts_active_staff_key" ON "driver_shifts" USING btree ("staff_user_id") WHERE "driver_shifts"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_shifts_active_truck_key" ON "driver_shifts" USING btree ("truck_id") WHERE "driver_shifts"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "driver_shifts_started_at_idx" ON "driver_shifts" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_name_key" ON "trucks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "trucks_active_idx" ON "trucks" USING btree ("active");--> statement-breakpoint
ALTER TABLE "pickup_tasks" ADD CONSTRAINT "pickup_tasks_driver_shift_id_driver_shifts_id_fk" FOREIGN KEY ("driver_shift_id") REFERENCES "public"."driver_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_members_can_drive_idx" ON "staff_members" USING btree ("can_drive","active");--> statement-breakpoint
CREATE INDEX "pickup_tasks_shift_status_idx" ON "pickup_tasks" USING btree ("driver_shift_id","status");--> statement-breakpoint

-- Migration 0016 promises RLS is ON for every table in `public`, and
-- `pnpm db:status` asserts it. Where the `ensure_rls` event trigger exists it
-- has already done this; where the `postgres` role lacks superuser — the
-- normal Supabase case — nothing would have. Enabling twice is a no-op.
--
-- No policy is added. These tables are reached only through `@koolee/core` on
-- the direct connection, which bypasses RLS, so the empty-policy deny is the
-- correct posture for `anon`/`authenticated`.
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.driver_positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The drop half. Everything below removes dead scaffolding — but only if it
-- is still dead.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  n_agents integer;
  n_drivers integer;
  n_routes integer;
BEGIN
  SELECT count(*) INTO n_agents FROM agents;
  SELECT count(*) INTO n_drivers FROM drivers;
  SELECT count(*) INTO n_routes FROM routes;

  IF n_agents + n_drivers + n_routes > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop: agents=%, drivers=%, routes=%. These tables were empty in every environment when 0029 was written, which is the whole basis for dropping them. A row means somebody started using one — work out who before running this.',
      n_agents, n_drivers, n_routes;
  END IF;
END $$;--> statement-breakpoint

-- FK order, no CASCADE: routes references drivers, nothing references agents.
DROP TABLE "routes";--> statement-breakpoint
DROP TABLE "drivers";--> statement-breakpoint
DROP TABLE "agents";--> statement-breakpoint
-- Only `routes.status` used it.
DROP TYPE "public"."route_status";
