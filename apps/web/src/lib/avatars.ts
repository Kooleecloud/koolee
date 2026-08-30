import "server-only";

import { avatarPathsForViewer, BUCKETS, type CoreConfig, type Session } from "@koolee/core";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Avatar storage, customer side.
 *
 * A DEPARTURE FROM `passport-photos`, on purpose. That module uses the
 * service-role client because its bucket policy admits active staff only, and
 * a customer can never satisfy it. The `avatars` policy (0027) is written the
 * other way round — "your own folder, whoever you are" — so writes here run as
 * the SIGNED-IN USER over the anon key, and RLS is the gate in every app
 * rather than something only the agent app is subject to. A path-building bug
 * in this file therefore fails at Storage instead of quietly writing into
 * somebody else's folder.
 *
 * The service-role client still appears once, for a read the customer's own
 * session provably cannot do: their assigned agent's avatar. A customer is not
 * staff, so 0027's SELECT policy refuses it — and it is the right refusal.
 * Core resolves the assignment first; this signs what core already vouched for.
 */

const SPEC = BUCKETS.avatars;

export const AVATAR_BUCKET = SPEC.id;

/** Signed URL for an avatar the SIGNED-IN USER is allowed to read. */
export async function signAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SPEC.signedUrlTtlSeconds);
  if (error) {
    console.error("[avatars] failed to sign URL", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** The raw service-role mint. Private on purpose — see the two callers below. */
async function signAsService(path: string): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SPEC.signedUrlTtlSeconds);
  if (error) {
    console.error("[avatars] failed to sign URL for viewer", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Signed URLs for the people on a booking, RESOLVED BY RELATIONSHIP.
 *
 * Callers name subject USER IDS and a booking, never a storage path, so there
 * is no signature this function can be handed a path with. That is the whole
 * change: the previous version took a path and carried a comment saying not to
 * pass one from a request, which is a convention rather than a control.
 *
 * `avatarPathsForViewer` decides — customer sees the agent and driver on their
 * own booking, staff see the customer of a booking they have a task on — and
 * only what comes back is signed. A subject the viewer may not see is absent
 * from the map, which renders as initials, identical to having no photo.
 */
export async function signAvatarUrlsForBooking(input: {
  db: CoreConfig["db"];
  viewer: Session;
  bookingId: string;
  subjectUserIds: readonly (string | null | undefined)[];
}): Promise<Map<string, string>> {
  const paths = await avatarPathsForViewer(input.db, {
    viewer: input.viewer,
    subjectUserIds: input.subjectUserIds,
    bookingId: input.bookingId,
  });
  if (paths.size === 0) return new Map();

  const signed = new Map<string, string>();
  await Promise.all(
    [...paths].map(async ([userId, path]) => {
      const url = await signAsService(path);
      if (url) signed.set(userId, url);
    }),
  );
  return signed;
}

/**
 * A driver on the SHORTLIST, before anybody is assigned.
 *
 * The one issuance path `avatarPathsForViewer` does not cover, and it is not
 * an omission: there is no relationship yet. The authorization is
 * `listCandidateDrivers` itself — ownership-checked, gated by
 * `assertActionable`, and the thing that decided to offer this driver at all.
 * Showing a first name and a face IS the shortlist feature.
 *
 * Kept as its own named function so that this exception is visible in a diff
 * rather than hidden inside a general-purpose helper.
 */
export async function signShortlistAvatarUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  return signAsService(path);
}

/** Uploads the bytes as the signed-in user and returns the storage path. */
export async function uploadAvatar(input: {
  path: string;
  data: Uint8Array;
  contentType: string;
}): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(input.path, input.data, { contentType: input.contentType, upsert: false });
  if (error) {
    console.error("[avatars] upload failed", error.message);
    return null;
  }
  return input.path;
}
