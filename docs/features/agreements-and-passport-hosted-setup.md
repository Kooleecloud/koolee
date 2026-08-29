# Hosted setup — agreements + passport verification

> **What reaches a hosted environment automatically, and what does not.**
> Feature reference: [agreements-and-passport.md](agreements-and-passport.md).
>
> ⚠️ **Migrations are applied by CI, not by hand.**
> [`.github/workflows/migrate.yml`](../../.github/workflows/migrate.yml) runs on
> every push to `dev` and `main` that touches `packages/db/drizzle/**`, applies
> pending migrations to that branch's database (`dev` → hosted dev, `main` →
> production), and then runs `db:status` to assert the applied set matches the
> checkout by content hash. Merging is the deploy. Do not also run
> `pnpm db:migrate` against hosted by hand — see §2.

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

Four, applied in one pass:

| Migration                                  | What                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `0022_funny_the_fallen`                    | the three tables, the append-only trigger, RLS, the `passport-photos` bucket and its policies    |
| `0023_passport_photos_staff_check`         | corrects 0022's storage policies to use `public.is_active_staff`, exactly as 0009 corrected 0008 |
| `0024_freeze_effective_agreement_versions` | a version freezes the moment it takes effect                                                     |
| `0025_pin_agreement_version_per_booking`   | `UNIQUE (booking_id)` — the version a booking accepts pins for life                              |

Applying them together is the easy path: 0022 creates `agreement_acceptances`
empty, so 0025's guard (below) has nothing to trip on.

**You do not run these.** Merging to `dev` applies them to hosted dev; merging
to `main` applies them to production. The workflow serializes on the migrator's
advisory lock and fails loudly on drift.

What to do instead:

1. **Before merging**, run the 0025 pre-check below against the target. CI
   applies migrations unattended, so a guard that trips there fails the
   workflow — better to know first.
2. **After the merge**, read the workflow run. Its last step is `db:status`;
   expect `Applied: 26 of 26 (matched by content hash)`.
3. **Only if you need to check the target yourself** — read-only, safe against
   production:

```bash
DIRECT_DATABASE_URL='postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:status
```

Session pooler, port **5432** — never the 6543 transaction pooler, and never
`db.<ref>.supabase.co` (IPv6-only)
([MIGRATIONS §3](../MIGRATIONS.md#3-the-two-connection-rule)).

### The one pre-check 0025 can fail on

`0025` adds `UNIQUE (booking_id)` to `agreement_acceptances` and **refuses to
migrate** if any booking holds more than one acceptance. It does not
deduplicate: those rows are append-only evidence that a named person agreed to
specific terms, and a migration must not delete them (it would have to disable
the append-only trigger to do it). Which acceptance governs is a decision a
person makes and records.

Run this on the target before migrating. Zero rows means 0025 will apply
cleanly:

```sql
SELECT booking_id, count(*) AS acceptances
FROM agreement_acceptances
GROUP BY booking_id
HAVING count(*) > 1;
```

It returns nothing on a database that has never had `agreement_acceptances`
(0022 creates it empty), and nothing on a database migrated to 0025 in one
pass — the only way to produce a second row is to run the **re-acceptance
model** that existed between 0022 and 0025 and have a customer accept twice.

**If it ever does return rows**, do not delete. Copy the superseded rows into
an archive table, record who decided and why, then remove them from the live
table with the trigger disabled for exactly that statement — and keep the
earliest acceptance per booking, because under version pinning the version in
force when the contract was formed is the one that governs. Ask before doing
this; it is a legal record, not a data cleanup.

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
  `/agreements`. Title, rich-text body, effective-from (blank = immediately).
  Publishing asks for no confirmation because it disturbs nobody: under version
  pinning it applies to bookings made from its effective date onward, and any
  booking that has already accepted keeps the version it accepted.
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
