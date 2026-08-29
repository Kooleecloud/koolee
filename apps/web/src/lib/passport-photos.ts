import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Storage access for passport photos, on the customer's side of the product.
 *
 * `passport-photos` is a PRIVATE bucket (migration 0022) and
 * `passport_verifications.photo_storage_path` holds a STORAGE PATH, never a
 * URL. Handing one of those to an `<img src>` renders a broken image; handing
 * out a public URL would be far worse, so there is no public URL to hand out.
 *
 * Why the service-role client: the bucket's storage policies admit active
 * STAFF only, which is what lets the agent app upload over the anon key. A
 * customer session cannot mint a signed URL for its own passport under those
 * policies, so the web app does it server-side — after core has already
 * resolved the booking through an ownership check. Never call these with a
 * path that did not come out of such a check.
 *
 * TTL is deliberately shorter than the bag-photo one. A signed URL is a bearer
 * credential for the object, and this object is somebody's passport: the page
 * is server-rendered on every request anyway, so nothing is gained by letting
 * the link outlive the view.
 */

const SIGNED_URL_TTL_SECONDS = 120;

export const PASSPORT_BUCKET = "passport-photos";

/** Signed URL for one passport photo, or null if it cannot be signed. */
export async function signPassportPhotoUrl(path: string): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  if (!admin || !path) return null;

  const { data, error } = await admin.storage
    .from(PASSPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("[passport-photos] failed to sign URL", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Uploads the bytes and returns the storage path.
 *
 * `upsert: false` with a fresh uuid per object: a replacement is a NEW object,
 * never an overwrite of the old one. Overwriting would destroy the photo the
 * custody trail already points at, and the trail is the thing that has to stay
 * answerable.
 */
export async function uploadPassportPhoto(input: {
  bookingId: string;
  data: Uint8Array;
  contentType: string;
  extension: string;
}): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;

  const path = `passports/${input.bookingId}/${crypto.randomUUID()}.${input.extension}`;
  const { error } = await admin.storage
    .from(PASSPORT_BUCKET)
    .upload(path, input.data, { contentType: input.contentType, upsert: false });
  if (error) {
    console.error("[passport-photos] upload failed", error.message);
    return null;
  }
  return path;
}
