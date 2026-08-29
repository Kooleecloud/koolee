"use client";

import { useRouter } from "next/navigation";
import { BUCKETS } from "@koolee/core";
import {
  AvatarUploader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

/**
 * The agent's own face, on the tab that already answers "who am I signed in
 * as". Same uploader and same route contract as the customer app — see
 * `@koolee/ui`'s `AvatarUploader`.
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
        <CardTitle className="text-base">Your photo</CardTitle>
        <CardDescription>
          Customers see this on their trip page before you arrive, so they know who to
          expect at the door.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AvatarUploader
          endpoint="/api/avatars"
          currentUrl={currentUrl}
          name={name}
          accept={BUCKETS.avatars.mimeTypes}
          maxBytes={BUCKETS.avatars.maxUploadBytes}
          onUploaded={() => router.refresh()}
        />
      </CardContent>
    </Card>
  );
}
