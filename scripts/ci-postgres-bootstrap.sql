-- ---------------------------------------------------------------------------
-- The minimum Supabase surface a plain Postgres needs before this repo's
-- migrations will apply. Run ONCE, against the CI service container, before
-- `pnpm db:migrate`. See .github/workflows/ci.yml.
--
-- WHY THIS FILE EXISTS. `packages/db/README.md` says the migrations "still run
-- against a plain Postgres 16 (docker-compose, CI)". That is true of 0001's
-- RLS block, which is guarded, and of 0022/0023/0026/0027, which check
-- `to_regclass('storage.buckets')` first. It is NOT true of 0008 and 0009:
-- they write `storage.buckets`, create policies on `storage.objects` and call
-- `auth.uid()` with no guard at all, so a bare `postgres:16` dies at 0008 with
-- `relation "storage.buckets" does not exist`. Measured, not assumed.
--
-- WHY NOT FIX THE MIGRATIONS. `db:status` compares the applied set to this
-- checkout BY CONTENT HASH. Editing 0008 or 0009 would make every already
-- migrated database — hosted dev, and later prod — report drift and fail the
-- migrate workflow. A migration that has been applied is frozen. So the
-- environment moves to meet the migrations, not the other way round.
--
-- WHY NOT `supabase start` IN CI. That is eleven containers and several
-- minutes for a database the integration tier uses as a plain Postgres. The
-- two suites that genuinely need GoTrue refuse to run without it and are
-- excluded from the workflow by name — see the run report.
--
-- These objects are DELIBERATELY NOT FAITHFUL to Supabase's real definitions.
-- They are the smallest shapes the migrations touch. Nothing may depend on
-- them beyond making the DDL apply.
-- ---------------------------------------------------------------------------

-- The three roles the storage policies and 0031's grant name.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- `auth.uid()`. Reads the same GUC GoTrue sets, so a policy that calls it
-- parses and evaluates; in CI nothing sets the claim, so it returns NULL.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Storage. Only the columns 0008/0022/0026/0027 write.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);

-- The storage policies in 0008/0022/0027 are only meaningful with RLS on, and
-- `CREATE POLICY` on a table without it is a silent no-op rather than an error
-- — which is the failure mode this repo has now hit three times.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- `(storage.foldername(name))[1]` — the owner-folder test in 0027's avatars
-- policies. Same semantics as Supabase's: every path segment but the last.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END
$fn$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

-- The publication 0001 and 0030 add tables to. Without it their guards skip,
-- and the publication membership this repo cares about would go untested.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- The marker `packages/core/vitest.global-setup.ts` refuses to run without.
-- It is the guard that stops a mispointed TEST_DATABASE_URL from emptying a
-- database somebody is using, and it fails closed, so CI has to opt in
-- explicitly — exactly as `scripts/test-env.sh` does locally.
CREATE TABLE IF NOT EXISTS __koolee_test_database (
  note text NOT NULL DEFAULT
    'Disposable. Created by scripts/ci-postgres-bootstrap.sql for the CI integration tier.'
);
