-- ---------------------------------------------------------------------------
-- 0020 — at most one active pricing rule, enforced by the database.
--
-- WHY THIS EXISTS
--
-- The pricing engine reads "the" active rule; the seed used to heal whatever
-- `limit(1)` happened to find, which let stale fixture rules stay active
-- alongside the real one (the #41/#51 leakage class). A partial unique index
-- on `active WHERE active` gives every active row the same key, so a second
-- `active = true` is a clean 23505 instead of a silent second rule.
--
-- DEDUP FIRST: if more than one active rule exists, keep the most recently
-- created one (that is the row `ORDER BY created_at DESC LIMIT 1` readers
-- would favor) and deactivate the rest, loudly. Rows are deactivated, never
-- deleted — pricing history stays intact.
--
-- NOT `CONCURRENTLY` (same reasoning as 0017/0019): the migrator runs in one
-- transaction; the SHARE lock on this tiny table is milliseconds.
-- ---------------------------------------------------------------------------

DO $$
DECLARE deactivated integer;
BEGIN
  UPDATE pricing_rules
     SET active = false
   WHERE active
     AND id <> (
       SELECT id FROM pricing_rules
        WHERE active
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     );
  GET DIAGNOSTICS deactivated = ROW_COUNT;
  IF deactivated > 0 THEN
    RAISE NOTICE 'pricing_rules: deactivated % extra active rule(s), kept the newest', deactivated;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_one_active_key" ON "pricing_rules" USING btree ("active") WHERE "pricing_rules"."active";