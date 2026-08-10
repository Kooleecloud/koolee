-- Fix for the 0008 storage policies: their EXISTS subquery on
-- public.staff_members runs as the `authenticated` role, which has no
-- privileges on that table ("permission denied for table staff_members").
-- Granting SELECT to `authenticated` would expose the staff roster through
-- PostgREST, so the check moves into a SECURITY DEFINER function instead:
-- executable by authenticated sessions, while the table itself stays closed.

CREATE OR REPLACE FUNCTION public.is_active_staff(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = uid AND sm.active
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_active_staff(uuid) FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid) TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS "bag_photos_staff_insert" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "bag_photos_staff_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'bag-photos' AND public.is_active_staff(auth.uid()));
--> statement-breakpoint
DROP POLICY IF EXISTS "bag_photos_staff_read" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "bag_photos_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bag-photos' AND public.is_active_staff(auth.uid()));
