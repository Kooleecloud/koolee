import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiHttpError } from "./errors";

/**
 * The app uploads photos straight to Supabase Storage under its own session
 * and then tells the route the object key. Before that key goes anywhere
 * near the custody trail, two things are checked here: the key sits under
 * the prefix this booking/bag/user owns, and the object actually exists —
 * proven by signing it as the caller, which also fails if the bucket policy
 * would not let them read it.
 */

const SAFE_KEY = /^[A-Za-z0-9_\-./]+$/;

export function assertPathUnderPrefix(
  path: string,
  prefix: string,
  field = "storagePath",
): void {
  const ok =
    SAFE_KEY.test(path) &&
    !path.includes("..") &&
    !path.startsWith("/") &&
    path.startsWith(prefix) &&
    path.length > prefix.length;
  if (!ok) {
    throw new ApiHttpError("invalid_input", "That photo doesn't belong to this step.", {
      field,
    });
  }
}

export async function assertObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  field = "storagePath",
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error) {
    throw new ApiHttpError("invalid_input", "That photo wasn't found. Upload it again.", {
      field,
    });
  }
}

/** Null on any failure: a missing avatar is a blank circle, not an error. */
export async function signUrl(
  supabase: SupabaseClient,
  bucket: string,
  path: string | null | undefined,
  ttlSeconds: number,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
