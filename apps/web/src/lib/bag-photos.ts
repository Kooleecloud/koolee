import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Signed URLs for bag and custody evidence photos.
 *
 * `bag-photos` is a PRIVATE bucket (migration 0008) and the database stores
 * STORAGE PATHS, not URLs — `bags.photo_urls` and `custody_events.photo_url`
 * both hold `<booking>/<file>` keys written by the agent app. Handing one of
 * those to an <img src> renders a broken image, which is exactly what the
 * customer's trip page did before this existed.
 *
 * Why the service-role client: the bucket's read policy admits active STAFF
 * only, so a customer session cannot mint these itself. Authorization is not
 * weakened by that — the trip page has already resolved the booking through
 * `getBookingDetailForSession`, so the only paths reaching here are ones that
 * belong to a booking this viewer is allowed to see. Never call this with
 * paths that did not come out of such a check.
 *
 * Short TTL: these URLs are bearer credentials for a private object, and the
 * page is server-rendered on every request anyway.
 */

const SIGNED_URL_TTL_SECONDS = 300;

/** storage path → signed URL. Missing entries mean "could not sign". */
export async function signBagPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return map;

  // Degrade, don't throw: without the service key the trip page still renders,
  // just without evidence photos. Scaffold convention (see supabase/admin.ts).
  const admin = getSupabaseAdminClient();
  if (!admin) return map;

  const { data, error } = await admin.storage
    .from("bag-photos")
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error("[bag-photos] failed to sign evidence photo URLs", error);
    return map;
  }
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) map.set(entry.path, entry.signedUrl);
  }
  return map;
}
