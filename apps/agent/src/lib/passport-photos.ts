import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Passport-photo storage, from the agent's side.
 *
 * This app deliberately holds NO service-role key (least privilege for a
 * shared, frequently-lost device), so both the upload and the signed URL run
 * as the SIGNED-IN AGENT over the anon key. Migration 0022's storage policies
 * are therefore the gate: only an active `staff_members` row may write or read
 * objects in the private `passport-photos` bucket. That is the same
 * arrangement `bag-photos` has had since 0008, and the same reason it does not
 * conflict with "authorization lives in core, not RLS" — that rule is about
 * server-side TABLE queries on the service-role connection, and Storage
 * without a service key has exactly one authorization mechanism.
 *
 * Short TTL: this URL is a bearer credential for a photo of somebody's
 * passport, and the page it appears on is server-rendered on every request.
 */

const SIGNED_URL_TTL_SECONDS = 120;

export const PASSPORT_BUCKET = "passport-photos";

export async function signPassportPhotoUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(PASSPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("[passport-photos] failed to sign URL", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Uploads a capture and returns its storage path, or null on failure.
 *
 * A fresh uuid per object and no upsert: a re-capture is a NEW object, so the
 * photo the custody trail already names is never destroyed by a retake.
 */
export async function uploadPassportPhoto(input: {
  bookingId: string;
  data: Uint8Array;
  contentType: string;
  extension: string;
}): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const path = `passports/${input.bookingId}/${crypto.randomUUID()}.${input.extension}`;
  const { error } = await supabase.storage
    .from(PASSPORT_BUCKET)
    .upload(path, input.data, { contentType: input.contentType, upsert: false });
  if (error) {
    console.error("[passport-photos] upload failed", error.message);
    return null;
  }
  return path;
}
