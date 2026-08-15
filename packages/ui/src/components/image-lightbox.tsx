"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

export interface ImageLightboxProps {
  /** Full-size source. Signed URLs are fine — nothing is re-fetched on open. */
  src: string;
  /** Describes the photo for screen readers AND names it in the dialog header. */
  alt: string;
  /** Dialog heading. Falls back to `alt`. */
  title?: string;
  /** Optional line under the heading — seal id, weight, who took it. */
  description?: React.ReactNode;
  /** Extra classes for the thumbnail button (sizing lives with the caller). */
  className?: string;
  /** Thumbnail classes. Defaults to a square cover crop. */
  imageClassName?: string;
}

/**
 * A photo thumbnail that opens full-size in a dialog.
 *
 * Evidence photos are captured at ~1200px and displayed at 78–190px, so
 * without this the detail that makes them evidence — the seal number on the
 * tag, the state of a zip, a scuff — is present in the file and invisible on
 * screen. Ops settles damage claims from these; the agent needs to confirm
 * their own capture is not a blurred thumb over the lens.
 *
 * The trigger is a real <button>: a bare <img> with an onClick is invisible to
 * the keyboard, and these sit in tables an operator tabs through.
 */
function ImageLightbox({
  src,
  alt,
  title,
  description,
  className,
  imageClassName,
}: ImageLightboxProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "group relative overflow-hidden rounded-md border transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
            className,
          )}
          aria-label={`Enlarge: ${alt}`}
        >
          {/* A plain img by design: sources are signed storage URLs and
              local object URLs of unknown dimensions, and this package is
              framework-agnostic — next/image would tie it to Next. */}
          <img
            src={src}
            alt={alt}
            className={cn("h-full w-full object-cover", imageClassName)}
          />
        </button>
      </DialogTrigger>

      {/* Wider than the default dialog: the point is to see the photo. */}
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? alt}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {/* Capped by viewport height so a portrait photo cannot push the
            footer off-screen — the close button must always be reachable. */}
        <img
          src={src}
          alt={alt}
          className="max-h-[65vh] w-full rounded-md object-contain"
        />

        {/* The ✕ in the header corner is easy to miss on a phone; this is the
            deliberate one. Both close the same dialog. */}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ImageLightbox };
