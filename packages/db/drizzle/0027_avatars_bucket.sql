ALTER TABLE "users" ADD COLUMN "avatar_storage_path" text;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- CUSTOM ADDITIONS TO 0027 (hand-written below the generated DDL).
--
-- The `avatars` bucket, and the first storage policies in this codebase that
-- are NOT "active staff only".
--
-- ONE BUCKET FOR EVERY ROLE. `public.users` holds customers, agents, drivers
-- and admins in one table with `auth.uid() = users.id` (0001), so a per-user
-- folder is all the separation anyone needs. Object keys are
-- `<userId>/<uuid>.<ext>` with NO prefix folder — the user id has to be the
-- FIRST path segment, because that is what `storage.foldername(name)[1]`
-- returns and the whole policy hangs off it.
--
-- WRITES: your own folder, whoever you are. Every app uploads over the ANON
-- key as the signed-in user (the customer app included, which is a departure
-- from `passport-photos` — there the web app uses the service role because a
-- customer cannot satisfy a staff-only policy). Here RLS is the only gate in
-- all three apps, so no service-role path can write into somebody else's
-- folder because of a bug in how we built a string.
--
-- READS: your own folder, or any folder if you are active staff — an agent
-- needs to recognise the customer at the door, and the admin console lists
-- faces. The one read this does NOT cover is a customer seeing their assigned
-- agent's avatar; that is signed service-role in the web app AFTER core has
-- resolved that this agent is actually on this booking, the same shape as
-- passport photo signing.
--
-- NO UPDATE OR DELETE POLICY, deliberately. A new avatar is a new object
-- (`upsert: false`, fresh uuid), exactly like bag and passport photos, so
-- nothing ever needs to overwrite. The superseded object is orphaned on
-- purpose and waits for the same retention sweep the other buckets want.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not detected — skipping avatars bucket (expected on plain Postgres).';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('avatars', 'avatars', false, 3145728, ARRAY['image/jpeg','image/png','image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public             = EXCLUDED.public,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE 'DROP POLICY IF EXISTS "avatars_own_insert" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "avatars_own_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'avatars'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "avatars_own_or_staff_read" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "avatars_own_or_staff_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'avatars'
      AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR public.is_active_staff(auth.uid())
      )
    )
  $pol$;
END
$$;
