-- Booking display zone + the customer's own zone at booking time.
--
-- `display_tz` is NOT NULL, so it cannot be added in one statement: drizzle's
-- generated `ADD COLUMN ... NOT NULL` (with no default) aborts the moment the
-- table has a single row in it. Split into the standard three steps instead —
-- add nullable, backfill from the airport each booking already points at, then
-- constrain.
--
-- Backfill is exact, not a guess: `bookings.departure_airport` is a foreign key
-- to `airports.code`, so every row resolves and the FK guarantees no orphans.
-- The `coalesce` is belt-and-braces for a hypothetical airport row with a NULL
-- tz, which the schema disallows.
--
-- Lock/scale notes: `ADD COLUMN` (nullable, no default) is metadata-only and
-- instant. The UPDATE rewrites every row and takes ROW EXCLUSIVE — fine at
-- Koolee's current size, and it should be batched if `bookings` is ever large.
-- `SET NOT NULL` takes a brief ACCESS EXCLUSIVE lock and scans the table to
-- verify; also fine here, but it is the statement that would need a
-- NOT VALID CHECK + VALIDATE dance on a big table.

ALTER TABLE "bookings" ADD COLUMN "display_tz" text;--> statement-breakpoint

UPDATE "bookings" AS b
SET "display_tz" = coalesce(a."tz", 'America/New_York')
FROM "airports" AS a
WHERE a."code" = b."departure_airport"
  AND b."display_tz" IS NULL;--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "display_tz" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "bookings" ADD COLUMN "booked_from_tz" text;
