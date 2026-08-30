import { and, eq, or } from "drizzle-orm";
import {
  bookings,
  pickupTasks,
  staffMembers,
  verificationTasks,
  type Database,
} from "@koolee/db";

import type { Session } from "../auth/types";
import { listUserAvatarPaths } from "./avatars";

/**
 * WHOSE FACE MAY THIS PERSON SEE?
 *
 * Avatars live in a private bucket and are only ever read through a signed
 * URL, which is a bearer credential for that object. Minting one is therefore
 * an authorization decision, and before this module it was made by
 * CONSTRUCTION — the path only reached a render because a join had already
 * proved the relationship — with a comment on the signing helper saying
 * "never call this with a path that arrived from a request".
 *
 * A comment is not an enforcement. This is: callers name a SUBJECT and a
 * BOOKING, never a storage path, and get back only the paths the relationship
 * actually permits.
 *
 * THE RELATIONSHIPS, and each one's reason:
 *
 *  - **Yourself.** Always. Whoever you are.
 *  - **An admin sees anyone.** The console lists the whole staff roster and
 *    every booking's people; an admin session already means an active
 *    `staff_members` row with role `admin`, re-checked per request.
 *  - **A customer sees the people on their own booking** — the agent assigned
 *    to the visit and the driver assigned to the pickup — from assignment
 *    onward. Not before: there is nobody to show.
 *  - **Staff see the customer of a booking they have a task on.** The person
 *    who opens the door should be recognisable to the person knocking, and
 *    the reverse.
 *
 * NOBODY ELSE. An agent with no task on a booking cannot fetch its customer;
 * a customer cannot fetch an agent who is not theirs.
 *
 * NOT COVERED HERE, deliberately: the driver SHORTLIST. Those four faces are
 * shown before anybody is assigned, so no relationship exists yet — the
 * authorization is `listCandidateDrivers` itself, which is ownership-checked
 * and gated by `assertActionable`, and which decides who to offer. Offering
 * somebody's first name and face IS the feature; see `signShortlistAvatarUrl`
 * in the web app, which is the only other issuance path and says so.
 */

export interface AvatarVisibilityQuery {
  viewer: Session;
  /** Whose faces are being asked for. Duplicates and blanks are ignored. */
  subjectUserIds: readonly (string | null | undefined)[];
  /**
   * The booking that supposedly connects them. Omitted → only the viewer's
   * own avatar (and, for an admin, everyone's) can come back.
   */
  bookingId?: string | undefined;
}

/**
 * Storage paths the viewer may see, keyed by subject user id.
 *
 * A subject with no avatar, or one the viewer may not see, is simply absent —
 * every surface already falls back to initials, so "not permitted" and "no
 * photo" render identically and neither is a disclosure.
 *
 * ONE QUERY FOR THE RELATIONSHIP, one for the paths, whatever the number of
 * subjects. The trip page asks for an agent and a driver together; a per-face
 * round trip is the shape that turns a card into a query budget.
 */
export async function avatarPathsForViewer(
  db: Database,
  query: AvatarVisibilityQuery,
): Promise<Map<string, string>> {
  const subjects = [...new Set(query.subjectUserIds.filter((id): id is string => Boolean(id)))];
  if (subjects.length === 0) return new Map();

  const viewerId = query.viewer.userId;
  const permitted = new Set<string>();

  // Yourself, always.
  if (subjects.includes(viewerId)) permitted.add(viewerId);

  // An admin sees the whole roster and every booking's people.
  if (query.viewer.kind === "admin") {
    for (const id of subjects) permitted.add(id);
  } else if (query.bookingId) {
    const [row] = await db
      .select({
        customerUserId: bookings.userId,
        agentUserId: verificationTasks.assigneeUserId,
        driverUserId: pickupTasks.assigneeUserId,
      })
      .from(bookings)
      .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
      .leftJoin(pickupTasks, eq(pickupTasks.bookingId, bookings.id))
      .where(eq(bookings.id, query.bookingId))
      .limit(1);

    if (row) {
      if (query.viewer.kind === "customer" && row.customerUserId === viewerId) {
        // The two people who will physically be at this customer's door.
        if (row.agentUserId) permitted.add(row.agentUserId);
        if (row.driverUserId) permitted.add(row.driverUserId);
      }
      if (
        query.viewer.kind === "agent" &&
        (row.agentUserId === viewerId || row.driverUserId === viewerId)
      ) {
        permitted.add(row.customerUserId);
      }
    }
  }

  const wanted = subjects.filter((id) => permitted.has(id));
  if (wanted.length === 0) return new Map();
  return listUserAvatarPaths(db, wanted);
}

/** One subject. Same rules; see `avatarPathsForViewer`. */
export async function avatarPathForViewer(
  db: Database,
  query: Omit<AvatarVisibilityQuery, "subjectUserIds"> & {
    subjectUserId: string | null | undefined;
  },
): Promise<string | null> {
  if (!query.subjectUserId) return null;
  const paths = await avatarPathsForViewer(db, {
    viewer: query.viewer,
    subjectUserIds: [query.subjectUserId],
    ...(query.bookingId === undefined ? {} : { bookingId: query.bookingId }),
  });
  return paths.get(query.subjectUserId) ?? null;
}

/**
 * Whether a staff member may replace somebody else's photo.
 *
 * Only an admin, and only for a member of staff. Replacing a CUSTOMER's photo
 * is deliberately not a capability: it is their face, they own it, and an
 * operator editing it is a moderation action this product has decided not to
 * have in v1. Removing an unsuitable staff photo is an HR matter and the
 * console is where it belongs.
 */
export async function canReplaceAvatarOf(
  db: Database,
  viewer: Session,
  subjectUserId: string,
): Promise<boolean> {
  if (viewer.kind !== "admin") return false;
  if (viewer.userId === subjectUserId) return true;

  const row = await db.query.staffMembers.findFirst({
    where: and(
      eq(staffMembers.userId, subjectUserId),
      eq(staffMembers.active, true),
      or(eq(staffMembers.role, "agent"), eq(staffMembers.role, "admin")),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}
