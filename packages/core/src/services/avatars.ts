import { eq, inArray } from "drizzle-orm";
import { users, type Database, type User } from "@koolee/db";

import { InvalidInputError, NotFoundError } from "../errors";

/**
 * Profile pictures, for every role in one table.
 *
 * `users` holds customers, agents, drivers and admins together, so there is
 * one avatar mechanism rather than four. What differs by role is only which
 * app offers the upload UI.
 *
 * WHAT IS STORED: an object key in the PRIVATE `avatars` bucket, never a URL —
 * the same rule as bag and passport photos, for the same reason. Whoever
 * renders it mints a signed URL; nothing in the database is a link anybody
 * could paste.
 *
 * THE PATH PREFIX IS LOAD-BEARING. Keys are `<userId>/<uuid>.<ext>`, and
 * migration 0027's storage policy admits a write only when the first folder
 * segment equals `auth.uid()`. `setUserAvatar` re-checks that prefix here
 * rather than trusting it, because RLS protects the OBJECT and this check
 * protects the ROW: without it, a bug that built the wrong path would point
 * one person's profile at another person's face even though Storage had
 * correctly refused the upload.
 */

/** The first path segment must be the owner. See the note above. */
function assertOwnedPath(userId: string, storagePath: string): void {
  const trimmed = storagePath.trim();
  if (!trimmed || !trimmed.startsWith(`${userId}/`)) {
    // InvalidInput, not Conflict: nothing collided. Reaching this means the
    // key was built wrong, which is a bug on our side, never a user's doing.
    throw new InvalidInputError(
      "avatarStoragePath",
      "That avatar path does not belong to this account.",
    );
  }
}

export interface SetUserAvatarInput {
  userId: string;
  /** Path in the PRIVATE `avatars` bucket — `<userId>/<uuid>.<ext>`. */
  storagePath: string;
}

/**
 * Points a profile at a newly uploaded object.
 *
 * The previous object is NOT deleted — a replacement is a new key, and the old
 * one is orphaned for the same retention sweep the other buckets are waiting
 * on. Deleting here would be an irreversible write triggered by an ordinary
 * "actually, use this photo instead".
 */
export async function setUserAvatar(
  db: Database,
  input: SetUserAvatarInput,
): Promise<User> {
  const storagePath = input.storagePath.trim();
  assertOwnedPath(input.userId, storagePath);

  const [row] = await db
    .update(users)
    .set({ avatarStoragePath: storagePath })
    .where(eq(users.id, input.userId))
    .returning();

  if (!row) throw new NotFoundError("User", input.userId);
  return row;
}

/**
 * Clears the profile picture, leaving the initials fallback.
 *
 * Storage keeps the object, exactly as a replacement does. "Remove my picture"
 * is a display decision; purging the bytes is a retention decision, and they
 * are not the same request.
 */
export async function clearUserAvatar(db: Database, userId: string): Promise<User> {
  const [row] = await db
    .update(users)
    .set({ avatarStoragePath: null })
    .where(eq(users.id, userId))
    .returning();

  if (!row) throw new NotFoundError("User", userId);
  return row;
}

/** One user's avatar key, or null when they have never set one. */
export async function getUserAvatarPath(
  db: Database,
  userId: string,
): Promise<string | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { avatarStoragePath: true },
  });
  return row?.avatarStoragePath ?? null;
}

/**
 * Avatar keys for a set of users, keyed by user id.
 *
 * For lists — the staff table, a booking's people — where signing N URLs from
 * N separate queries is the shape that turns one table into N round-trips.
 * Users with no avatar are simply absent from the map.
 */
export async function listUserAvatarPaths(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: users.id, avatarStoragePath: users.avatarStoragePath })
    .from(users)
    .where(inArray(users.id, unique));

  return new Map(
    rows
      .filter((row): row is { id: string; avatarStoragePath: string } =>
        Boolean(row.avatarStoragePath),
      )
      .map((row) => [row.id, row.avatarStoragePath]),
  );
}
