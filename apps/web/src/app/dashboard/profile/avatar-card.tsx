"use client";

import { useRouter } from "next/navigation";
// Subpath, NOT the package barrel: the barrel reaches `runtime.ts` →
// `@koolee/db` → the `postgres` driver, which cannot resolve `fs` in a
// browser bundle. `@koolee/core/uploads` imports nothing.
import { BUCKETS } from "@koolee/core/uploads";
import { AvatarUploader } from "@koolee/ui";

/**
 * The customer's profile picture, as ONE control inside the details card.
 *
 * It used to be its own card with a heading, a full-width "Change photo"
 * button, a "Remove" button and a paragraph of explanation. Three changes:
 *
 *  - **No card.** The picture is a field of an identity, not a subject.
 *  - **No Remove.** The journey is initials → a photo → a different photo.
 *    Going back to initials is not something anybody wants, and offering it
 *    put a destructive control next to a cosmetic one.
 *  - **A camera badge**, not a button. See `layout="overlay"`.
 *
 * `AvatarUploader` lives in `@koolee/ui`, which holds no Next dependency, so
 * the refresh is passed in rather than imported there. `router.refresh()` is
 * also what re-signs the URL — the page is server-rendered and the signed URL
 * is minted per request, so re-fetching the RSC payload is the whole update.
 */
export function AvatarCard({
  currentUrl,
  name,
}: {
  currentUrl: string | null;
  name: string | null;
}) {
  const router = useRouter();

  return (
    <AvatarUploader
      endpoint="/api/avatars"
      currentUrl={currentUrl}
      name={name}
      accept={BUCKETS.avatars.mimeTypes}
      maxBytes={BUCKETS.avatars.maxUploadBytes}
      onUploaded={() => router.refresh()}
      layout="overlay"
      allowRemove={false}
    />
  );
}
