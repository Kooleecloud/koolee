"use client";

import { useRouter } from "next/navigation";
// Subpath, NOT the package barrel: the barrel reaches `runtime.ts` →
// `@koolee/db` → the `postgres` driver, which cannot resolve `fs` in a
// browser bundle. `@koolee/core/uploads` imports nothing.
import { BUCKETS } from "@koolee/core/uploads";
import { AvatarUploader, Card, CardContent, CardHeader, CardTitle } from "@koolee/ui";

/**
 * Thin client wrapper: the shared uploader plus this app's way of re-rendering.
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile picture</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AvatarUploader
          endpoint="/api/avatars"
          currentUrl={currentUrl}
          name={name}
          accept={BUCKETS.avatars.mimeTypes}
          maxBytes={BUCKETS.avatars.maxUploadBytes}
          onUploaded={() => router.refresh()}
        />
        <p className="text-xs text-muted-foreground">
          Your agent sees this when they arrive, so they know they have the right person.
          Optional — we show your initials otherwise.
        </p>
      </CardContent>
    </Card>
  );
}
