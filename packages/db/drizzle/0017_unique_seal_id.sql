-- ---------------------------------------------------------------------------
-- 0017 — a seal id identifies exactly one bag.
--
-- WHY THIS EXISTS
--
-- `bags.seal_id` carried a plain (non-unique) index, so nothing stopped the
-- same printed seal number being recorded against every bag in a booking. It
-- was found in testing: three bags, one seal id, all accepted. A tamper-evident
-- seal is single-use — a repeated id means either a typo or a physically reused
-- seal, and in a damage or loss dispute the seal id is the thing that ties a
-- sealed bag to a custody event. Two bags answering to one id makes that record
-- undefendable.
--
-- Scope is the whole table, not one booking: seals come off a single numbered
-- stock, so the id is globally unique by construction.
--
-- PARTIAL, because every unsealed bag holds NULL. (Postgres would allow the
-- repeated NULLs even in a total unique index, but the partial index is also
-- the smaller, honest statement of the rule: it constrains sealed bags.)
--
-- NOT `CONCURRENTLY`: drizzle's migrator runs every pending migration inside
-- one transaction, and CREATE INDEX CONCURRENTLY cannot run in a transaction
-- block. The plain build takes a SHARE lock on `bags`, blocking writes to that
-- table while it runs — measured in milliseconds at present volumes. If `bags`
-- ever grows past the point where that is acceptable, build the index
-- out-of-band with CONCURRENTLY first; this statement is then a no-op thanks to
-- IF NOT EXISTS.
--
-- BEFORE APPLYING, check for existing duplicates — the index build fails if any
-- exist, and it should, but you want the list first, not a failed migration:
--
--   SELECT seal_id, count(*), array_agg(id)
--     FROM bags WHERE seal_id IS NOT NULL
--    GROUP BY seal_id HAVING count(*) > 1;
--
-- Test bookings carrying duplicates should be cleared (or their seal ids
-- corrected) by hand before this runs.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "bags_seal_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bags_seal_id_key"
  ON "bags" USING btree ("seal_id")
  WHERE "bags"."seal_id" is not null;
