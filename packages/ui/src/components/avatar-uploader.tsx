"use client";

import * as React from "react";
import { Camera, Trash2 } from "lucide-react";

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

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-4">
        <Avatar size="xl" name={name} src={shown} alt="" />

        <div className="flex flex-col items-start gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={accept.join(",")}
            className="sr-only"
            onChange={onPick}
          />
          <Button
            type="button"
            variant="outline"
            loading={busy === "upload"}
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
          >
            <Camera aria-hidden="true" />
            {shown ? "Change photo" : "Add a photo"}
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
