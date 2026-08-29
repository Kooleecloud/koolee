import "server-only";

import { BUCKETS } from "@koolee/core";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Avatar storage, console side.
 *
 * Runs as the signed-in admin over the anon key even though this app HAS a
 * service-role client. That is the point: an admin is active staff, so
 * migration 0027's read policy already admits every folder and its write
 * policy admits their own — the service key would buy nothing here except a
 * path that bypasses the check. It stays reserved for the things RLS genuinely
 * cannot express.
 */

const SPEC = BUCKETS.avatars;

export const AVATAR_BUCKET = SPEC.id;

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
 * Signs many at once, keyed by storage path.
 *
 * The staff table renders every operator in the org; signing those one at a
 * time is one round-trip per row for a page that already knows the whole set.
 * A path that fails to sign is simply absent, and the caller falls back to
 * initials — a table that renders is worth more than a table that is right
 * about every face.
 */
export async function signAvatarUrls(
  paths: readonly (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return new Map();

  const supabase = await getSupabaseServerClient();
  if (!supabase) return new Map();

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(unique, SPEC.signedUrlTtlSeconds);
  if (error) {
    console.error("[avatars] failed to sign URLs", error.message);
    return new Map();
  }

  const signed = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

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
