-- ---------------------------------------------------------------------------
-- Storage buckets become DECLARED state.
--
-- Until now the three buckets came into existence three different ways:
-- `bag-photos` from 0008, `passport-photos` from 0022, and `ticket-uploads`
-- from a `createBucket` call inside the upload route the first time a customer
-- attached a ticket. None of them set `file_size_limit` or
-- `allowed_mime_types`, so every one of them accepted a 50 MB file of any type
-- the moment a caller reached Storage by some path that skipped our own checks.
--
-- This migration makes `storage.buckets` converge on the values declared in
-- `@koolee/core`'s `BUCKETS` (packages/core/src/uploads/buckets.ts), which
-- `buckets.test.ts` parses this file to verify. Two consequences worth naming:
--
--   * ON CONFLICT DO UPDATE, not DO NOTHING. 0008 and 0022 both used DO
--     NOTHING, which is why re-running them changes nothing on an environment
--     where the bucket already exists — exactly the wrong behaviour for
--     declared state. Re-applying this one converges.
--
--   * `public` is re-asserted false on every apply. If somebody flips a bucket
--     public in the dashboard, the next migration puts it back. That is the
--     single worst misconfiguration available here (every passport photo
--     world-readable by URL), so it gets repaired rather than merely created.
--
-- The limits are BACKSTOPS. Each app still checks size and type first, because
-- a Storage rejection surfaces as a generic failure while an app check can say
-- "keep it under 8 MB". `bucketMaxBytes >= maxUploadBytes` for every bucket,
-- asserted in the same test.
--
-- Guarded on `storage.buckets` existing so a plain Postgres (docker-compose,
-- CI) still migrates cleanly, the same guard 0022 uses.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not detected — skipping bucket configuration (expected on plain Postgres).';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('ticket-uploads',  'ticket-uploads',  false, 12582912, ARRAY['application/pdf','image/jpeg','image/png']),
    ('bag-photos',      'bag-photos',      false,  5242880, ARRAY['image/jpeg','image/png','image/webp']),
    ('passport-photos', 'passport-photos', false, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public             = EXCLUDED.public,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END
$$;
