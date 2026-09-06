-- ---------------------------------------------------------------------------
-- 0021 — bookings.ref: a human-quotable booking reference, KOO-XXXXX.
--
-- WHY THIS EXISTS
--
-- The confirmation email's own doc comment promised a "ref" and no such
-- column existed (validation report D1), so the email identified a booking by
-- flight + a UUID trip link. Meanwhile the two consoles had each grown their
-- own substitute DERIVED from the id — `KL-` + last six hex in apps/web, bare
-- last six hex in apps/admin — which meant one booking had two different
-- "references" depending on where you looked. This column replaces both.
--
-- The five payload characters are Crockford base32:
--   0123456789ABCDEFGHJKMNPQRSTVWXYZ
-- I, L, O and U are absent, so no glyph pair a human can confuse survives and
-- a ref read out over a phone transcribes back to the same row. 32^5 ≈ 33.5M.
--
-- DISPLAY AND SUPPORT ONLY. Nothing authenticates on this value and no public
-- route looks a booking up by it; the trip page stays UUID-addressed.
--
-- THREE STEPS, NOT ONE (the §3.1 pattern). Drizzle's generated diff was a
-- single `ADD COLUMN ... NOT NULL`, which fails outright on any table that
-- already has rows. Nullable → backfill → constrain is the only shape that
-- survives contact with existing data.
--
-- LOCKS / BLAST RADIUS, per statement:
--   1. ADD COLUMN, nullable, no default — catalog-only in PG11+, instant, no
--      table rewrite.
--   2. Backfill — row-by-row inside this transaction, so the collision check
--      sees rows written moments earlier and no partial index is needed yet.
--      Linear in row count; at Koolee's current scale this is milliseconds.
--      Bounded at 20 attempts per row and RAISEs rather than looping forever.
--   3. SET NOT NULL — ACCESS EXCLUSIVE plus one full scan to verify. Brief on
--      a small table; it is the statement to watch if `bookings` ever gets big.
--   4. CREATE UNIQUE INDEX, not CONCURRENTLY (same reasoning as 0017/0019/0020:
--      the migrator runs in one transaction, and CONCURRENTLY cannot).
-- ---------------------------------------------------------------------------

ALTER TABLE "bookings" ADD COLUMN "ref" varchar(9);--> statement-breakpoint

DO $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  target record;
  candidate text;
  attempt integer;
  filled integer := 0;
BEGIN
  FOR target IN SELECT id FROM bookings WHERE ref IS NULL ORDER BY created_at LOOP
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      candidate := 'KOO-'
        || substr(alphabet, 1 + floor(random() * 32)::int, 1)
        || substr(alphabet, 1 + floor(random() * 32)::int, 1)
        || substr(alphabet, 1 + floor(random() * 32)::int, 1)
        || substr(alphabet, 1 + floor(random() * 32)::int, 1)
        || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM bookings WHERE ref = candidate);
      IF attempt >= 20 THEN
        RAISE EXCEPTION
          'bookings.ref backfill: 20 consecutive collisions for booking %. The keyspace is exhausted or random() is degenerate.',
          target.id;
      END IF;
    END LOOP;
    UPDATE bookings SET ref = candidate WHERE id = target.id;
    filled := filled + 1;
  END LOOP;
  IF filled > 0 THEN
    RAISE NOTICE 'bookings.ref: backfilled % existing booking(s)', filled;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "ref" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_ref_key" ON "bookings" USING btree ("ref");
