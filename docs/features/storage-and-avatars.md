# Storage buckets, and profile pictures

> **Every object this product stores, where it lives, who may read it, and the
> one place its limits are declared.** Baseline: `dev` @ `5db21a4`.
>
> For migration mechanics read [../MIGRATIONS.md](../MIGRATIONS.md). For the
> passport photo's own rules read
> [agreements-and-passport.md](agreements-and-passport.md).

---

## 1. Buckets are declared, not created

Before this slice, the four buckets came into existence three different ways:
`bag-photos` from migration 0008, `passport-photos` from 0022, and
`ticket-uploads` from a `createBucket` call inside the upload route, the first
time an environment ever received a ticket. None of the migration-made buckets
set `file_size_limit` or `allowed_mime_types`, so each accepted a 50 MB file of
any type from any path that reached Storage without passing an app check.

Now there is one source of truth —
[`packages/core/src/uploads/buckets.ts`](../../packages/core/src/uploads/buckets.ts) —
and migrations converge `storage.buckets` on it:

| Bucket            | `file_size_limit` | `allowed_mime_types`                    | App limit | Signed-URL TTL |
| ----------------- | ----------------- | --------------------------------------- | --------- | -------------- |
| `ticket-uploads`  | 12 MiB            | `application/pdf`, `image/jpeg/png`     | 10 MiB    | 300 s          |
| `bag-photos`      | 5 MiB             | `image/jpeg`, `image/png`, `image/webp` | 4 MiB     | 300 s          |
| `passport-photos` | 10 MiB            | `image/jpeg`, `image/png`, `image/webp` | 8 MiB     | 120 s          |
| `avatars`         | 3 MiB             | `image/jpeg`, `image/png`, `image/webp` | 2 MiB     | 3600 s         |

Every bucket is **private**. There is no public URL to a passport, a bag, a
ticket or a face, and 0026 re-asserts `public = false` on every apply so a
dashboard slip is repaired by the next migration rather than living forever.

### The two numbers, and why they differ

`bucketMaxBytes` is a **backstop**; `maxUploadBytes` is the **UX gate**. The
rule — asserted in
[`buckets.test.ts`](../../packages/core/src/uploads/buckets.test.ts) — is
`bucketMaxBytes >= maxUploadBytes`, never the reverse. Inverted, Storage
rejects a file the app already accepted, and the customer reads "something went
wrong" instead of "keep it under 8 MB", because a Storage rejection arrives as
an opaque failure with no size in it.

### What stops them drifting

The migration SQL is parsed by `buckets.test.ts` and compared to `BUCKETS`
field by field. Raising a limit in TypeScript without writing the migration
fails the test rather than silently shipping a bucket that rejects at the old
ceiling. Parsing SQL with a regex is normally a bad idea; here the alternative
is generating a file drizzle's journal has already hashed, which cannot be
regenerated without rewriting history.

### What this cannot cover

Supabase enforces a **project-wide** upload ceiling (Dashboard → Storage →
Settings, 50 MB by default) with no SQL surface. Every `bucketMaxBytes` must
stay under it. It is the one storage number not tracked in the repo.

### No bucket is created at runtime

`/api/ticket-uploads` used to call `createBucket` on every upload. It no
longer does. A request path that creates infrastructure is a request path that
can create it _wrong_ — and that call was the only place in the product where a
bucket's limits were ever set, which is exactly how every other bucket ended up
with none. The trade is explicit: a fresh environment that has not migrated now
fails a ticket upload loudly instead of quietly building itself something
slightly different.

---

## 2. Who may read and write

| Bucket            | Write                                | Read                                                       |
| ----------------- | ------------------------------------ | ---------------------------------------------------------- |
| `ticket-uploads`  | web app, service-role                | service-role                                               |
| `bag-photos`      | active staff (0008/0009 policies)    | active staff                                               |
| `passport-photos` | active staff; web app service-role   | active staff; web app service-role                         |
| `avatars`         | **your own folder, whoever you are** | your own folder, **or** any folder if you are active staff |

`avatars` is the first bucket whose policies are not "active staff only", which
changes which client each app uses:

- **Writes run over the ANON key in all three apps**, as the signed-in user —
  the customer app included, which is a departure from `passport-photos`. RLS is
  therefore the gate everywhere, so a path-building bug fails at Storage rather
  than quietly writing into somebody else's folder.
- The **one** service-role read is a customer seeing their assigned agent's
  face. A customer is not staff, so 0027's policy refuses it correctly; core
  resolves the assignment first and the web app signs what core vouched for.

### The path prefix is load-bearing

Avatar keys are `<userId>/<uuid>.<ext>` with **no prefix folder**. The user id
must be the first segment, because 0027's policy matches
`(storage.foldername(name))[1] = auth.uid()::text`. Every app builds the key
through [`avatarObjectPath`](../../packages/core/src/uploads/buckets.ts) rather
than inline — three apps writing the same string three times is three chances
to write it differently — and `setUserAvatar` re-checks the prefix before
recording the row, because RLS protects the _object_ while that check protects
the _row_.

---

## 3. Profile pictures, end to end

One `users` table holds customers, agents, drivers and admins, so there is one
avatar mechanism rather than four. What differs by role is only which app
offers the picker.

```
  pick file ──► downscalePhoto (≤1600px, ~700 KB)   [browser]
            └─► POST /api/avatars (multipart)
                  └─► handleAvatarUpload            [@koolee/core]
                        ├─ size / MIME / extension
                        ├─ storage.upload(<userId>/<uuid>.<ext>)   ← RLS gate
                        └─ setUserAvatar(db, …)     ← only after the object lands
```

**Store first, then record.** A `users.avatar_storage_path` pointing at an
object that failed to upload is a broken image on every screen that person
appears on. The reverse — an object nobody references — is an orphan, which is
what a retention sweep is for.

**A replacement is a new object.** Fresh uuid, `upsert: false`, and the
superseded object is deliberately not deleted: a signed URL already handed out
keeps resolving, and deleting here would be an irreversible write triggered by
an ordinary "actually, use this one". `clearUserAvatar` clears the pointer and
leaves the bytes for the same reason — removing your picture is a display
decision, purging bytes is a retention decision.

### Where it appears

| App     | Uploads                                                          | Displays                                                                 |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `web`   | `/dashboard/profile` → "Profile picture"                         | own profile; the assigned agent AND the selected driver on the trip page |
| `agent` | `/account` → "Your photo"                                        | own account header; the customer on the visit screen                     |
| `admin` | console settings sheet → Account; **`/staff` → any staff photo** | own chrome (top bar + sheet); the staff table                            |

The console has no account route, so the settings sheet _is_ the account
surface and the picker lives there rather than behind one more click to a page
that would exist only to hold it.

### Replacing somebody else's photo (2026-08-29)

`/staff` has a **Photo** action per row, in a dialog rather than inline: a
picker per row would put a dozen file inputs on one page, and this is a rare
action with a real consequence. It exists because a face on a doorstep is
operational — an agent with no photo is a stranger at a customer's door, and
asking each of them to fix it themselves is how it stays broken.

Two things differ from every other upload, and both follow from `0027`:

1. **RLS cannot be the gate.** The insert policy is `your own folder, whoever
you are`, so a cross-folder write is refused — correctly, because that
   policy is what stops a path-building bug writing into a stranger's folder.
   The check therefore happens in code first: `canReplaceAvatarOf`
   (packages/core) admits an **admin acting on a member of active staff**, and
   nobody else.
2. **It runs service-role**, only after that check, through
   `uploadAvatarAsService` — the one place in the product that writes into
   somebody else's folder.

A **customer's** photo is deliberately out of reach from the console. It is
their face; editing it would be a moderation capability this product has
decided not to have in v1.

---

## 3.1 Who may SEE whose face

Issuing a signed URL is an authorization decision — the URL is a bearer
credential for a private object. Until F2 that decision was made by
_construction_ (a path only reached a render because a join had already proved
the relationship) and guarded by a comment on the signing helper saying "never
call this with a path that arrived from a request".

A comment is not a control.
[`services/avatar-visibility.ts`](../../packages/core/src/services/avatar-visibility.ts)
is: callers name subject **user ids** and a booking, never a path.

| Viewer   | May see                                                    |
| -------- | ---------------------------------------------------------- |
| anyone   | themselves                                                 |
| customer | the agent and the driver assigned to **their own** booking |
| staff    | the customer of a booking **they have a task on**          |
| admin    | anyone                                                     |

An unassigned agent cannot fetch a customer's face; a customer cannot fetch an
agent who is not theirs; naming somebody else's booking id changes nothing.
Fifteen integration tests cover exactly those refusals.

**The one exception, named rather than hidden:** the driver **shortlist**. Four
faces are shown before anybody is assigned, so no relationship exists yet — the
authorization is `listCandidateDrivers` itself, which is ownership-checked,
gated by `assertActionable`, and is the thing that decided to offer that driver
at all. It has its own function (`signShortlistAvatarUrl`) so the exception
shows up in a diff.

**Known coarseness, deliberately left:** `0027`'s _Storage_ read policy admits
any active staff member to any avatar folder, which is broader than the table
above. Tightening it would break the agent seeing the customer at the door,
object keys carry an unguessable uuid so folders are not enumerable, and the
app never hands staff a path they were not entitled to. The fine-grained rule
is enforced at **issuance**, in application code, which is where this codebase
puts authorization anyway.

### The fallback is the design

Most people have no photo. [`Avatar`](../../packages/ui/src/components/avatar.tsx)
renders initials on a tint derived from the name, stable across every screen,
so the same person is the same two letters and the same colour in the staff
table and on the trip page. A grey placeholder head for everybody makes a list
unreadable at a glance.

It also falls back on **load failure**, which is not an edge case: signed URLs
expire after an hour, so a stale tab will hand the component a URL that 403s.
It lands on initials rather than a broken-image glyph.

### HEIC is deliberately out

An iPhone shares photos as `image/heic` unless the app re-encodes. Every
capture path here runs `downscalePhoto`, which hands back a JPEG, so they are
unaffected. A raw file picker (`ticket-uploads`) is not — and HEIC stays out
because the extractor cannot read it, so accepting it would trade a clear
"we can't read that format" for a silent "unreadable" three steps later.

---

## 4. Applying this to a hosted environment

Migrations 0026 and 0027 are applied by CI on merge, like every other
migration — see
[agreements-and-passport-hosted-setup.md §2](agreements-and-passport-hosted-setup.md).
Neither takes a lock worth planning around: single-row upserts on a catalog
table, two `CREATE POLICY` on `storage.objects`, and one nullable `ADD COLUMN`
on `users`.

Verify afterwards:

```sql
-- All four present, all private, all limited.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets order by id;

-- Both avatar policies, matching on the first path segment.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'avatars%';
```

`public` must be `false` on every row. If any is `true`, every object in that
bucket is world-readable by URL — set it back and work out who changed it.

**Smoke test:** sign in as a customer → `/dashboard/profile` → add a photo → it
renders back. Open the same booking as the assigned agent → the customer's face
is on the visit screen. Open the console → your own face in the top bar, and the
staff table shows everyone.
