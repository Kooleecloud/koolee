# Hosted setup — agreements + passport verification

> **The manual steps for a hosted environment (dev, prod).** Everything here is
> TD's to run: migrations are LOCAL-ONLY from this repo's tooling by design
> ([PROJECT-STATUS §3.1](../../PROJECT-STATUS.md)). Feature reference:
> [agreements-and-passport.md](agreements-and-passport.md).

---

## 1. New environment variables

**None.** Nothing in this slice reads a new environment variable, in any app or
in `packages/core`. Stated explicitly because "no new env" is the kind of claim
that is worth being able to check: the validity-checker seam is injected
through `createRuntime` with a `{ kind: "none" }` config literal and has no
credential to resolve, the private bucket is reached with the Supabase URL and
keys the apps already hold, and the agreement body is data in a table.

---

## 2. Apply the migrations

Two: `0022_funny_the_fallen` (tables, append-only trigger, RLS, the
`passport-photos` bucket and its policies) and `0023_passport_photos_staff_check`
(corrects 0022's storage policies to use `public.is_active_staff`, exactly as
0009 corrected 0008 — see the header comment in 0023).

Check first, then apply. **Read the `Target host:` line both times.**

```bash
# 1. What does the target actually have?
DIRECT_DATABASE_URL='postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:status

# 2. Apply
DIRECT_DATABASE_URL='postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:migrate

# 3. Confirm — expect "Applied: 24 of 24 (matched by content hash)"
DIRECT_DATABASE_URL='…' pnpm db:status
```

Direct connection, port **5432** — never the 6543 pooler
([MIGRATIONS §3](../MIGRATIONS.md#3-the-two-connection-rule)).

**If 0022 reports as STRANDED** (its timestamp at or below the target's
watermark), regenerate it with a newer timestamp — never edit journal rows
([§3.1](../../PROJECT-STATUS.md)).

---

## 3. The `passport-photos` bucket

Migration 0022 creates it and 0023 fixes its policies, so on a Supabase project
**applying the migrations is the whole step** — there is nothing to click. The
bucket block is guarded on `to_regclass('storage.buckets')`, so it is a no-op on
a plain Postgres (docker-compose, CI) rather than a failure.

Verify after migrating:

```sql
-- Must exist, and `public` MUST be false.
select id, public from storage.buckets where id = 'passport-photos';

-- Both policies present, and both calling is_active_staff (NOT an inline
-- EXISTS on staff_members — that is the 0022 bug 0023 fixes).
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'passport_photos%';
```

If `public` is ever `true`, stop: every passport photo is world-readable by
URL. Set it back with
`update storage.buckets set public = false where id = 'passport-photos';`
and work out who changed it.

> **Only if a project somehow has no `is_active_staff`** (it arrived in 0009, so
> every environment should): 0023 assumes the function exists and does not
> recreate it. `select proname from pg_proc where proname = 'is_active_staff';`

---

## 4. Seed the first agreement version

The gate **fails closed**: with no published version, every visit is blocked at
the identity step. That is deliberate, and it means a hosted environment needs
exactly one of the following before it can take a booking through pickup:

- **Preferred — publish the real terms** from the admin console at
  `/agreements`. Title, Markdown body, effective-from (blank = immediately).
  The form makes you tick a box naming how many in-flight bookings will be asked
  to re-accept.
- **Dev only — run the seed**, which upserts the placeholder v1
  (`pnpm seed` against that project). The placeholder says so in its own last
  line and must not be what a real customer agrees to.

Verify:

```sql
select version, title, effective_from from agreement_versions order by version desc;
```

---

## 5. Smoke test on the target

1. Open a paid booking's trip page as its customer → the **Action needed**
   section shows the agreement card with an accept CTA, and the passport card
   badged `optional`.
2. Accept → the card flips to `accepted` with the version and timestamp, and
   `agreement.accepted` appears in the custody trail.
3. Add a passport photo → it renders back (signed URL, 120s). If it does not,
   check §3's policy query — a broken policy shows up here first.
4. As the **assigned** agent, open the visit → both halves render; the photo is
   visible; the seal steps stay hidden until the passport is confirmed.
5. Confirm → the seal steps appear.

Step 3 and step 4's photo are the two that exercise storage RLS. Everything
else runs on the direct connection, where RLS is never consulted — which is
precisely why the 0022 policy bug reached a browser before it reached a test.
