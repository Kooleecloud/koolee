import { MAX_TICKET_UPLOAD_BYTES, TICKET_UPLOAD_MIME_TYPES } from "../extraction/types";

/**
 * Every Supabase Storage bucket this product owns, declared once.
 *
 * WHY THIS FILE EXISTS. Until now the limits lived in four unrelated places —
 * a route constant, an agent action constant, the extraction types, and a
 * `createBucket` call — and nothing made them agree. A bucket whose
 * `file_size_limit` is BELOW the app's own check is the bad case: the app
 * accepts the file, Storage rejects it, and the customer reads "something went
 * wrong" instead of "keep it under 8 MB". So the rule is written into the
 * types here and asserted in `buckets.test.ts`:
 *
 *     bucketMaxBytes >= maxUploadBytes, always.
 *
 * `bucketMaxBytes` is a BACKSTOP, not a UX gate. It catches a path that
 * reaches Storage without going through an app check; the app's own limit is
 * what a person actually sees a message about.
 *
 * HOW IT REACHES THE DATABASE. `packages/db/drizzle/0026_bucket_config.sql`
 * upserts exactly these values into `storage.buckets`, and
 * `buckets.test.ts` parses that SQL and fails if the two disagree. Buckets are
 * never created at runtime — no `createBucket` in any request path — so a
 * migration is the only way one comes into existence.
 *
 * PROJECT-WIDE CEILING. Supabase also enforces a global upload limit
 * (Dashboard → Storage → Settings, 50 MB by default) that no migration can
 * set. Every `bucketMaxBytes` here must stay under whatever that is; it is the
 * one number in this file that is not tracked by this file.
 */

export interface BucketSpec {
  /** Bucket id, which is also its name. */
  readonly id: string;
  /**
   * ALWAYS false. Every object we store is somebody's document, luggage, or
   * face; a public bucket makes all of them world-readable by URL, cached
   * beyond any later deletion. Reads are short-lived signed URLs only.
   */
  readonly isPublic: false;
  /** The largest upload an app may accept. This is the number people see. */
  readonly maxUploadBytes: number;
  /** `storage.buckets.file_size_limit`. Never below `maxUploadBytes`. */
  readonly bucketMaxBytes: number;
  /** `storage.buckets.allowed_mime_types`. Never null — an unset list accepts anything. */
  readonly mimeTypes: readonly string[];
  /** Signed-URL lifetime, chosen by how sensitive the object is. */
  readonly signedUrlTtlSeconds: number;
}

const MIB = 1024 * 1024;

/** JPEG/PNG/WebP — what `downscalePhoto` can produce and every browser can encode. */
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * NOTE ON HEIC: an iPhone shares photos as `image/heic` unless the app
 * re-encodes first. Our capture paths run `downscalePhoto`, which hands back a
 * JPEG, so they are unaffected. A raw file picker (ticket uploads) is not, and
 * HEIC stays OUT of the list deliberately — the extractor cannot read it, so
 * accepting it would trade a clear "we can't read that format" for a silent
 * "unreadable" three steps later.
 */

export const BUCKETS = {
  ticketUploads: {
    id: "ticket-uploads",
    isPublic: false,
    maxUploadBytes: MAX_TICKET_UPLOAD_BYTES,
    bucketMaxBytes: 12 * MIB,
    mimeTypes: TICKET_UPLOAD_MIME_TYPES,
    signedUrlTtlSeconds: 300,
  },
  bagPhotos: {
    id: "bag-photos",
    isPublic: false,
    maxUploadBytes: 4 * MIB,
    bucketMaxBytes: 5 * MIB,
    mimeTypes: PHOTO_MIME_TYPES,
    signedUrlTtlSeconds: 300,
  },
  passportPhotos: {
    id: "passport-photos",
    isPublic: false,
    maxUploadBytes: 8 * MIB,
    bucketMaxBytes: 10 * MIB,
    mimeTypes: PHOTO_MIME_TYPES,
    // A signed URL is a bearer credential for the object, and this object is
    // somebody's passport. The page is server-rendered per request anyway.
    signedUrlTtlSeconds: 120,
  },
  avatars: {
    id: "avatars",
    isPublic: false,
    // An avatar is displayed at 96px. `downscalePhoto` lands around 700 KB;
    // this only has to cover a browser that cannot downscale at all.
    maxUploadBytes: 2 * MIB,
    bucketMaxBytes: 3 * MIB,
    mimeTypes: PHOTO_MIME_TYPES,
    // Far longer than the evidence buckets: a face is low-sensitivity next to
    // a passport, and avatars re-render on every page. Still not public.
    signedUrlTtlSeconds: 3600,
  },
} as const satisfies Record<string, BucketSpec>;

export type BucketKey = keyof typeof BUCKETS;

/** Every spec, for the places that iterate (the SQL check, status output). */
export const ALL_BUCKETS: readonly BucketSpec[] = Object.values(BUCKETS);

/**
 * File extension per accepted MIME type.
 *
 * Storage object keys carry an extension so a downloaded object opens in the
 * right application. Derived from the MIME type we validated, NEVER from the
 * uploaded filename — a filename is attacker-controlled and an extension taken
 * from one is how you end up storing `avatar.php`.
 */
export const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** The MIME type is acceptable for this bucket AND has a known extension. */
export function extensionForUpload(spec: BucketSpec, mimeType: string): string | null {
  if (!spec.mimeTypes.includes(mimeType)) return null;
  return EXTENSION_BY_MIME_TYPE[mimeType] ?? null;
}

/**
 * Object key for one avatar upload: `<userId>/<uuid>.<ext>`.
 *
 * The user id MUST be the first path segment. Migration 0027's storage policy
 * admits a write only when `storage.foldername(name)[1]` equals `auth.uid()`,
 * so this shape is not a convention — it is the thing RLS checks. Every app
 * builds the key here rather than inline, because three apps writing the same
 * string three times is three chances to write it differently.
 *
 * A fresh uuid per upload, never a stable `<userId>.jpg`: a replacement is a
 * NEW object, so a signed URL already handed out keeps resolving to the image
 * it was minted for, and nothing is destroyed by a retake.
 */
export function avatarObjectPath(userId: string, extension: string): string {
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}
