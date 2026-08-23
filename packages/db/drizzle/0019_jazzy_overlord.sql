-- ---------------------------------------------------------------------------
-- 0019 — a booking has exactly one verification task and one pickup task.
--
-- WHY THIS EXISTS
--
-- Every reader already assumes one row per booking (`findFirst` / `limit 1`),
-- but nothing enforced it. The on-paid auto-assign trigger (this slice's
-- Phase 2) makes the gap load-bearing: the Stripe webhook and the
-- /book/return re-check race BY DESIGN, and without a unique index the loser
-- of the race quietly inserts a second task instead of failing. These indexes
-- are the concurrency guard — the second insert violates them cleanly and is
-- treated as "already assigned".
--
-- DEDUP FIRST, deterministically: any existing duplicates would fail the
-- index build. Keep the OLDEST row per booking (created_at, id as tiebreak —
-- the row every `findFirst` ordered by default insertion has been reading),
-- delete the rest, and RAISE NOTICE how many went so the removal is visible
-- in the migration output rather than silent.
--
-- NOT `CONCURRENTLY` (same reasoning as 0017): drizzle's migrator runs inside
-- one transaction; the plain build takes a SHARE lock measured in
-- milliseconds at present volumes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE removed integer;
BEGIN
  DELETE FROM verification_tasks vt
   USING verification_tasks keep
   WHERE keep.booking_id = vt.booking_id
     AND (keep.created_at, keep.id) < (vt.created_at, vt.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'verification_tasks: removed % duplicate row(s), kept oldest per booking', removed;
  END IF;

  DELETE FROM pickup_tasks pt
   USING pickup_tasks keep
   WHERE keep.booking_id = pt.booking_id
     AND (keep.created_at, keep.id) < (pt.created_at, pt.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'pickup_tasks: removed % duplicate row(s), kept oldest per booking', removed;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX "pickup_tasks_booking_id_idx";--> statement-breakpoint
DROP INDEX "verification_tasks_booking_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_tasks_booking_id_key" ON "pickup_tasks" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tasks_booking_id_key" ON "verification_tasks" USING btree ("booking_id");
