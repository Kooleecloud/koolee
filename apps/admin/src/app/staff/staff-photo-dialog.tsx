"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import {
  AvatarUploader,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@koolee/ui";
import { BUCKETS } from "@koolee/core/uploads";

/**
 * Replace a staff member's photo, from the console.
 *
 * The one place in the product where somebody changes a picture that is not
 * their own. It exists because a face on a doorstep is operational: an agent
 * with no photo, or a photo nobody would recognise them from, is a stranger at
 * a customer's door — and asking each of them to fix it themselves is how it
 * stays broken.
 *
 * IN A DIALOG, not inline in the row. A picker per row would put a dozen file
 * inputs on the staff page, and this is a rare action with a real consequence;
 * a deliberate step is the right shape for it.
 *
 * Reuses `AvatarUploader` unchanged — same downscale, same limits from the
 * bucket spec, same messages. What differs is one query parameter on the
 * endpoint, which the route authorizes with `canReplaceAvatarOf`.
 */
export function StaffPhotoDialog({
  userId,
  name,
  currentUrl,
}: {
  userId: string;
  name: string | null;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Change photo for ${name ?? "this operator"}`}
        >
          <ImagePlus aria-hidden="true" className="size-4" />
          Photo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name ? `${name}'s photo` : "Staff photo"}</DialogTitle>
          <DialogDescription>
            Customers see this face on their trip page once this person is assigned.
            Removing it leaves their initials.
          </DialogDescription>
        </DialogHeader>
        <AvatarUploader
          endpoint={`/api/avatars?userId=${encodeURIComponent(userId)}`}
          currentUrl={currentUrl}
          name={name}
          accept={BUCKETS.avatars.mimeTypes}
          maxBytes={BUCKETS.avatars.maxUploadBytes}
          onUploaded={() => router.refresh()}
        />
      </DialogContent>
    </Dialog>
  );
}
