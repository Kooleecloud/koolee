import { avatarObjectPath, BUCKETS, extensionForUpload } from "./buckets";

/**
 * The avatar upload pipeline, once, for three apps.
 *
 * Modelled on `handleTicketUpload`: validation and ordering live here as a
 * pure function over injected effects, so the rules are tested without a
 * Supabase project and each app's route handler is left with nothing but
 * "resolve who is asking, then call this".
 *
 * ORDER MATTERS — store first, then record. A `users.avatar_storage_path`
 * pointing at an object that failed to upload is a broken image on every
 * screen that person appears on. The reverse (an object nobody references) is
 * an orphan, which is what the retention sweep is for.
 */

export interface AvatarUploadStorage {
  /** Writes the object. Returns the path, or null if the write failed. */
  upload(input: {
    path: string;
    data: Uint8Array;
    contentType: string;
  }): Promise<string | null>;
}

export interface AvatarUploadDeps {
  /** The signed-in user. The object key is built from this, never from input. */
  userId: string;
  storage: AvatarUploadStorage;
  /** Usually `setUserAvatar(db, …)`. */
  recordAvatar(storagePath: string): Promise<void>;
}

export interface AvatarUploadFile {
  data: Uint8Array;
  mimeType: string;
}

export type AvatarUploadOutcome =
  { ok: true; storagePath: string } | { ok: false; status: number; error: string };

export const AVATAR_UPLOAD_COPY = {
  missing: "Choose a photo to use as your profile picture.",
  tooLarge: "That photo is too large — keep it under 2 MB.",
  badType: "Photos must be JPEG, PNG, or WebP.",
  storageFailed: "Something went wrong saving your photo. Please try again.",
} as const;

export async function handleAvatarUpload(
  deps: AvatarUploadDeps,
  file: AvatarUploadFile | null,
): Promise<AvatarUploadOutcome> {
  const spec = BUCKETS.avatars;

  if (!file || file.data.byteLength === 0) {
    return { ok: false, status: 400, error: AVATAR_UPLOAD_COPY.missing };
  }
  if (file.data.byteLength > spec.maxUploadBytes) {
    // 413 rather than 400: the file was fine, its size was not, and the
    // browser downscale is what normally keeps this from ever firing.
    return { ok: false, status: 413, error: AVATAR_UPLOAD_COPY.tooLarge };
  }

  // The extension comes from the VALIDATED MIME type, never from a filename.
  const extension = extensionForUpload(spec, file.mimeType);
  if (!extension) {
    return { ok: false, status: 415, error: AVATAR_UPLOAD_COPY.badType };
  }

  const storagePath = await deps.storage.upload({
    path: avatarObjectPath(deps.userId, extension),
    data: file.data,
    contentType: file.mimeType,
  });
  if (!storagePath) {
    // Covers the RLS refusal too: a path whose first segment is not this user
    // is rejected by the policy, and there is nothing the person can do about
    // it beyond retry, so the copy stays the same.
    return { ok: false, status: 503, error: AVATAR_UPLOAD_COPY.storageFailed };
  }

  await deps.recordAvatar(storagePath);
  return { ok: true, storagePath };
}
