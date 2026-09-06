import "server-only";

import { BUCKETS } from "@koolee/core";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Avatar storage, agent side.
 *
 * This app holds no service-role key (least privilege for a shared,
 * frequently-lost device), so everything runs as the signed-in agent over the
 * anon key and migration 0027's policies are the gate. Two of them apply here:
 * an agent writes only into their own folder, and — because they are active
 * staff — reads any folder, which is what lets the visit screen show the
 * customer's face next to the person at the door.
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
