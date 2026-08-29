-- ---------------------------------------------------------------------------
-- 0023 — fix 0022's passport-photos storage policies.
--
-- THE BUG, AND WHY IT IS THE SAME ONE AS 0008/0009.
--
-- 0022 wrote its policies with an inline `EXISTS (SELECT 1 FROM
-- public.staff_members …)`, copied from 0008's ORIGINAL form. That subquery
-- is evaluated as the `authenticated` role, which holds no privilege on
-- `staff_members`, so every policy evaluation raises
--
--     permission denied for table staff_members
--
-- Migration 0009 already fixed exactly this for `bag-photos` by moving the
-- check into the SECURITY DEFINER function `public.is_active_staff(uuid)` —
-- executable by authenticated sessions while the roster table itself stays
-- closed (granting SELECT to `authenticated` would expose the staff list
-- through PostgREST). 0022 reproduced the pre-0009 shape.
--
-- Caught in the browser, not by a test: the agent app's read of a customer's
-- pre-uploaded passport logged "failed to sign URL: permission denied for
-- table staff_members" and rendered no photo. The integration tier could not
-- have caught it — it exercises core against a direct connection, where
-- storage RLS is never consulted at all.
--
-- WHY A SEPARATE MIGRATION RATHER THAN AN EDIT TO 0022.
--
-- 0022 is already applied to the local database and recorded by content hash.
-- Editing it changes that hash, and its `folderMillis` is at the target's
-- watermark — so the edited file would be reported pending and then SKIPPED
-- FOREVER by the migrator (PROJECT-STATUS §3.1, "STRANDED"). The standing
-- rule is to write a corrective migration rather than edit history, which is
-- precisely what 0009 did to 0008. Squash the pair before merge if preferred.
--
-- `public.is_active_staff` already exists (0009); it is not redefined here.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not detected — nothing to fix (expected on plain Postgres).';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "passport_photos_staff_insert" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "passport_photos_staff_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'passport-photos' AND public.is_active_staff(auth.uid())
    )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "passport_photos_staff_read" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "passport_photos_staff_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'passport-photos' AND public.is_active_staff(auth.uid())
    )
  $pol$;
END
$$;
