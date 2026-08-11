-- Stable per-booking bag numbering.
--
-- Hand-edited from the drizzle-kit output, which emitted a single
-- `ADD COLUMN "ordinal" integer NOT NULL` — that cannot apply to a table that
-- already has rows. Split into add-nullable → backfill → enforce.

--> statement-breakpoint
-- 1. Nullable first. Metadata-only in PG 11+ (no default ⇒ no table rewrite).
ALTER TABLE "bags" ADD COLUMN "ordinal" integer;--> statement-breakpoint

-- 2. Backfill 1..n within each booking.
--    `created_at` is tied across a booking's bags (they are inserted in one
--    statement), so `id` is the tiebreak: stable, but an INVENTED order for
--    pre-existing rows — the real sequence was never recorded. Bags already
--    sealed are unaffected in practice: their seal id is their true identity.
UPDATE "bags" SET "ordinal" = s.n
FROM (
  SELECT id, row_number() OVER (
    PARTITION BY booking_id ORDER BY created_at, id
  ) AS n
  FROM "bags"
) s
WHERE "bags".id = s.id;--> statement-breakpoint

-- 3. Enforce, now that every row has a value.
ALTER TABLE "bags" ALTER COLUMN "ordinal" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bags_booking_ordinal_key" ON "bags" USING btree ("booking_id","ordinal");
