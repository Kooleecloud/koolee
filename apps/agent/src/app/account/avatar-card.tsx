"use client";

import { useRouter } from "next/navigation";
// Subpath, NOT the package barrel: the barrel reaches `runtime.ts` →
// `@koolee/db` → the `postgres` driver, which cannot resolve `fs` in a
// browser bundle. `@koolee/core/uploads` imports nothing.
import { BUCKETS } from "@koolee/core/uploads";
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
        {/*
          THE SAME AFFORDANCE THE CUSTOMER GETS. The default `row` layout
          renders a "Change photo" button and a bare "Remove" link beside the
          avatar; the customer's profile has used `overlay` — the picker ON
          the photo — since it was built, so staff and customers were being
          shown two different controls for one action. Reused rather than
          restyled: `AvatarUploader` already had the layout, nobody had
          passed it here.

          `allowRemove={false}` matches too. Removing a photo is not an
          action either app offers — replacing it is — and a link that only
          ever appears beside a photo somebody just added invites an undo
          nobody asked for.
        */}
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
      </CardContent>
    </Card>
  );
}
