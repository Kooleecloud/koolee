-- ---------------------------------------------------------------------------
-- 0025 — one acceptance per booking. The version a booking accepts pins.
--
-- THE RULE THIS ENCODES
--
-- A booking is a contract for ONE shipment, formed when the customer accepts.
-- The version they accepted governs that booking for its whole life; a newer
-- version applies to bookings made after it and never disturbs one already in
-- flight. So a second acceptance row for the same booking is not "accepting an
-- update" — it is a booking bound to two different documents at once.
--
-- The previous key, UNIQUE (booking_id, agreement_version_id), permitted
-- exactly one row per version, which was the shape of the re-acceptance model
-- this replaces.
--
-- WHY THE CONSTRAINT AND NOT JUST THE SERVICE CHECK
--
-- `acceptAgreement` reads "has this booking accepted anything" and then
-- inserts. That is check-then-act: two concurrent submits could each see no
-- acceptance and write one, leaving a booking pinned to two versions. The
-- unique index is what actually prevents it; the service check exists to
-- return a friendly no-op rather than a driver error.
--
-- IT REFUSES RATHER THAN DEDUPLICATES, DELIBERATELY
--
-- `agreement_acceptances` is append-only (0022) and is the evidence that a
-- named person agreed to specific terms at a specific instant. A migration
-- that silently deleted rows to satisfy a new constraint would destroy the
-- record of agreements people actually made — and it would have to disable the
-- append-only trigger to do it. If duplicates exist, a human decides which
-- acceptance governs and records that decision; a script must not.
--
-- In practice this cannot fire on any environment today: 0022 has only ever
-- been applied locally, and the re-acceptance path that could produce a second
-- row is being removed in the same change.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  offenders integer;
BEGIN
  SELECT count(*) INTO offenders FROM (
    SELECT booking_id
    FROM public.agreement_acceptances
    GROUP BY booking_id
    HAVING count(*) > 1
  ) dupes;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      'REFUSING TO MIGRATE: % booking(s) hold more than one agreement acceptance, '
      'which the new one-acceptance-per-booking rule cannot represent. These rows '
      'are append-only evidence and this migration will not delete them. Decide '
      'per booking which acceptance governs, record that decision, and remove the '
      'others deliberately before re-running. Query: SELECT booking_id, count(*) '
      'FROM agreement_acceptances GROUP BY booking_id HAVING count(*) > 1;',
      offenders
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "agreement_acceptances_booking_version_key";--> statement-breakpoint
DROP INDEX IF EXISTS "agreement_acceptances_booking_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_acceptances_booking_key" ON "agreement_acceptances" USING btree ("booking_id");--> statement-breakpoint
-- Kept for the FK and for "who accepted version X", which the composite key
-- used to serve as a prefix.
CREATE INDEX "agreement_acceptances_version_idx" ON "agreement_acceptances" USING btree ("agreement_version_id");
