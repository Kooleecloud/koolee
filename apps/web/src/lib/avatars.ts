import "server-only";

import { BUCKETS } from "@koolee/core";

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

/**
 * Signed URL for somebody else's avatar, service-role.
 *
 * ONLY for a path core has already authorized the viewer to see — today that
 * is the agent assigned to this customer's booking, and nothing else. Never
 * call this with a path that arrived from a request.
 */
export async function signAvatarUrlForViewer(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
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
