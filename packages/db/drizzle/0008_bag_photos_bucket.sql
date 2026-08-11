-- Bag-photo storage for the agent app.
--
-- The agent app deliberately holds NO service-role key (least privilege for
-- a shared, frequently-lost device), so its server-side uploads run as the
-- signed-in agent over the anon key. That makes storage RLS the gate here:
-- only ACTIVE STAFF may write or read objects in the private bag-photos
-- bucket. This does not conflict with "authorization lives in core, not
-- RLS" — that rule is about server-side *table* queries on the service-role
-- connection; Storage access without a service key has exactly one
-- authorization mechanism, and this is it.
--
-- Reads are still signed-URL only (the bucket is private); the SELECT
-- policy is what lets a staff session mint those signed URLs.

INSERT INTO storage.buckets (id, name, public)
VALUES ('bag-photos', 'bag-photos', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS "bag_photos_staff_insert" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "bag_photos_staff_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'bag-photos'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid() AND sm.active
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS "bag_photos_staff_read" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "bag_photos_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'bag-photos'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid() AND sm.active
  )
);
