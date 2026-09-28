import { z } from "zod";

/**
 * What the app uploads straight to Supabase Storage, and where.
 *
 * Mirrors `packages/core/src/uploads/buckets.ts` (the migration 0026/0027
 * bucket config). The APP limits are deliberately under the bucket limits:
 * a photo the app downscales to ~700 KB never gets near them, and the
 * ceiling is only a guard against a raw capture slipping through.
 *
 * Object keys: the device mints the uuid, the server checks the prefix.
 */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const imageMimeTypeSchema = z.enum(IMAGE_MIME_TYPES);
export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;

export const EXTENSION_BY_MIME_TYPE: Record<ImageMimeType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const UPLOAD_BUCKETS = {
  passportPhotos: {
    bucket: "passport-photos",
    maxUploadBytes: 8 * 1024 * 1024,
    prefix: (bookingId: string) => `passports/${bookingId}/`,
  },
  bagPhotos: {
    bucket: "bag-photos",
    maxUploadBytes: 4 * 1024 * 1024,
    prefix: (bagId: string) => `bags/${bagId}/`,
  },
  avatars: {
    bucket: "avatars",
    maxUploadBytes: 2 * 1024 * 1024,
    prefix: (userId: string) => `${userId}/`,
  },
} as const;

/** A fresh object key under the right prefix. Never reuse one: a retake is a NEW object. */
export function passportPhotoPath(
  bookingId: string,
  id: string,
  mime: ImageMimeType,
): string {
  return `${UPLOAD_BUCKETS.passportPhotos.prefix(bookingId)}${id}.${EXTENSION_BY_MIME_TYPE[mime]}`;
}
export function bagPhotoPath(bagId: string, id: string, mime: ImageMimeType): string {
  return `${UPLOAD_BUCKETS.bagPhotos.prefix(bagId)}${id}.${EXTENSION_BY_MIME_TYPE[mime]}`;
}
export function avatarPath(userId: string, id: string, mime: ImageMimeType): string {
  return `${UPLOAD_BUCKETS.avatars.prefix(userId)}${id}.${EXTENSION_BY_MIME_TYPE[mime]}`;
}

/** `POST /api/v1/account/avatar` — after the app uploaded the object itself. */
export const setAvatarRequestSchema = z.object({
  storagePath: z.string().min(1).max(512),
});
export type SetAvatarRequest = z.infer<typeof setAvatarRequestSchema>;

export const avatarResponseSchema = z.object({
  ok: z.literal(true),
  avatarUrl: z.string().nullable(),
  avatarStoragePath: z.string().nullable(),
});
export type AvatarResponse = z.infer<typeof avatarResponseSchema>;
