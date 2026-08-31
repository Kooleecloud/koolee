"use client";

import * as React from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { downscalePhoto } from "../lib/photo";
import { cn } from "../lib/utils";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { FormMessage } from "./form-message";

/**
 * Pick a profile picture, in the one shape every app uses.
 *
 * ONE COMPONENT, THREE APPS. The customer, the agent and the console all do
 * exactly this — pick, downscale, POST, re-render — and the only thing that
 * differs is which route handler receives it. So the endpoint is a prop and
 * the component holds no app-specific knowledge, which is also why it takes an
 * `onUploaded` callback instead of importing `useRouter`: this package
 * deliberately has no Next dependency.
 *
 * WHY IT DOWNSCALES FIRST. A phone camera hands back 3–8 MB. The avatar is
 * displayed at 96px. Sending the original would push a multi-megabyte body
 * through a route handler to store an image nobody will ever see at that
 * resolution — and on a bad connection, that is the difference between a
 * profile picture and a spinner. `downscalePhoto` is best-effort: a browser
 * that cannot decode hands the original back, and the server's own size check
 * is what refuses it, with a sentence rather than a 413.
 *
 * The local preview shows the DOWNSCALED file, not the original, so what you
 * see while it uploads is what actually gets stored.
 */

export interface AvatarUploaderProps {
  /** Route handler taking `POST` multipart (`avatar`) and `DELETE`. */
  endpoint: string;
  /** Current signed URL, or null. */
  currentUrl?: string | null;
  /** Drives the initials fallback. */
  name?: string | null;
  /** Accepted MIME types — pass the bucket spec's list so it cannot drift. */
  accept: readonly string[];
  /** Largest file the server will take, for the client-side message. */
  maxBytes: number;
  /** Called after a successful upload or removal — usually `router.refresh`. */
  onUploaded?: () => void;
  /** Hides the remove button where clearing makes no sense. */
  allowRemove?: boolean;
  /**
   * How the control presents itself.
   *
   *  - `row` — the avatar with labelled buttons beside it. Right where the
   *    picture is the subject of its own card (the staff consoles).
   *  - `overlay` — the avatar with a small camera badge on its top-right
   *    corner, and no visible label. Right where the picture sits inside a
   *    card about something else, as it does on the customer's profile: a
   *    full-width "Change photo" button next to a 96px avatar made the photo
   *    look like the point of the card, which it is not.
   *
   * The badge is still a real button with an accessible name, and the file
   * input behind it is unchanged — this is presentation, not a second path.
   */
  layout?: "row" | "overlay";
  /** Avatar size, from `Avatar`'s own scale. */
  size?: "lg" | "xl";
  className?: string;
}

const COPY = {
  tooLarge: (mb: number) => `That photo is too large — keep it under ${mb} MB.`,
  badType: "Photos must be JPEG, PNG, or WebP.",
  failed: "Something went wrong saving your photo. Please try again.",
  removeFailed: "Couldn't remove your photo. Please try again.",
};

export function AvatarUploader({
  endpoint,
  currentUrl,
  name,
  accept,
  maxBytes,
  onUploaded,
  allowRemove = true,
  layout = "row",
  size = "xl",
  className,
}: AvatarUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"upload" | "remove" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Object URLs are a leak if nobody revokes them, and this component can
  // produce one per attempt.
  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear immediately so picking the SAME file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    setError(null);
    if (!accept.includes(file.type)) {
      setError(COPY.badType);
      return;
    }

    setBusy("upload");
    try {
      const resized = await downscalePhoto(file);
      if (resized.size > maxBytes) {
        setError(COPY.tooLarge(Math.floor(maxBytes / (1024 * 1024))));
        return;
      }

      const objectUrl = URL.createObjectURL(resized);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return objectUrl;
      });

      const body = new FormData();
      body.append("avatar", resized);
      const response = await fetch(endpoint, { method: "POST", body });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? COPY.failed);
        // Drop the optimistic preview — it is now a lie about what is stored.
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
        return;
      }
      onUploaded?.();
    } catch {
      setError(COPY.failed);
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy("remove");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) {
        setError(COPY.removeFailed);
        return;
      }
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      onUploaded?.();
    } catch {
      setError(COPY.removeFailed);
    } finally {
      setBusy(null);
    }
  }

  const shown = preview ?? currentUrl ?? null;
  const pickLabel = shown ? "Change photo" : "Add a photo";

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept.join(",")}
      className="sr-only"
      onChange={onPick}
    />
  );

  if (layout === "overlay") {
    return (
      <div className={cn("flex flex-col items-center gap-2", className)}>
        <div className="relative">
          <Avatar size={size} name={name} src={shown} alt="" />
          {fileInput}
          {/*
            A button, not a label-wrapped input: the input has to stay
            `sr-only` and reachable, and a bare label is not focusable. The
            accessible name is the same sentence the row layout renders.
          */}
          <button
            type="button"
            aria-label={pickLabel}
            title={pickLabel}
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "absolute -right-1 -top-1 inline-flex size-8 items-center justify-center rounded-full",
              /*
               * QUIET AT REST, SOLID ON HOVER — and it was the other way
               * round, which read as the badge *losing* its background when
               * you pointed at it. A control that gets fainter under the
               * cursor is telling you the opposite of what a hover state is
               * for.
               *
               * At rest it is the icon alone, so the picture stays the
               * subject. The white halo under the glyph is what keeps it
               * legible on a dark photo, where a navy icon on no background
               * would disappear.
               */
              "border border-transparent bg-transparent text-navy-800",
              "[&_svg]:drop-shadow-[0_0_2px_rgb(255_255_255)]",
              "transition-colors hover:border-border hover:bg-background hover:shadow-sm",
              "hover:[&_svg]:drop-shadow-none",
              // Focus is a hover-equivalent here: a keyboard user must get the
              // same solid chip a pointer does.
              "focus-visible:border-border focus-visible:bg-background",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            {busy === "upload" ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Camera aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>

        {error ? <FormMessage variant="error">{error}</FormMessage> : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-4">
        <Avatar size={size} name={name} src={shown} alt="" />

        <div className="flex flex-col items-start gap-2">
          {fileInput}
          <Button
            type="button"
            variant="outline"
            loading={busy === "upload"}
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
          >
            <Camera aria-hidden="true" />
            {pickLabel}
          </Button>

          {allowRemove && currentUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy === "remove"}
              disabled={busy !== null}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <FormMessage variant="error">{error}</FormMessage> : null}
    </div>
  );
}
