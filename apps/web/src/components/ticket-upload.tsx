"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import { Camera, FileUp, Loader2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FormMessage } from "@koolee/ui";
import { MAX_TICKET_UPLOAD_BYTES, TICKET_UPLOAD_MIME_TYPES } from "@koolee/core/uploads";

import {
  TICKET_DEBUG_EVENT,
  TICKET_DEBUG_KEY,
} from "@/components/ticket-extraction-debug";

/**
 * Ticket upload → /api/ticket-uploads (server-side storage + extraction).
 *
 * What comes back only PREFILLS the flight review form — the customer always
 * reviews, edits and confirms there before anything is persisted. Extraction
 * never writes to a booking field; that is a standing rule, not a nicety.
 *
 * TWO VARIANTS, one pipeline.
 *
 *  - `door` is the funnel's front page. Most people photograph or forward an
 *    e-ticket; typing a flight number, an airport, a date, a time and a name
 *    is the slowest possible way to tell us something we can read off a
 *    document in four seconds. So the upload is the DEFAULT and the form is
 *    the alternative, which is the reverse of where this started.
 *  - `compact` is the card that used to live under the form, kept for the
 *    review and manual modes so somebody who started typing can still hand us
 *    the document instead.
 *
 * FAILURE IS TWO DIFFERENT THINGS, and conflating them is what made the old
 * card unhelpful:
 *
 *  - a file we will never accept (too big, wrong type) is RETRYABLE and the
 *    customer stays here, because picking a different file is one tap and
 *    dropping them into a form does not help;
 *  - a file we accepted and could not READ drops them straight into the manual
 *    form with a non-blaming line. Nothing is lost — the form is the same one
 *    they would have got, and they can upload again from it.
 */

/** Hands the raw diagnostics to the on-page debug panel, or clears them. */
function publishDebug(debug: unknown): void {
  try {
    if (debug === undefined) sessionStorage.removeItem(TICKET_DEBUG_KEY);
    else sessionStorage.setItem(TICKET_DEBUG_KEY, JSON.stringify(debug, null, 2));
    window.dispatchEvent(new Event(TICKET_DEBUG_EVENT));
  } catch {
    // Storage is unavailable (private mode); the panel simply stays empty.
  }
}

/** Statuses where picking a different file is the fix, so we stay put. */
const RETRYABLE_STATUSES = new Set([400, 413, 415]);

const ACCEPT = [...TICKET_UPLOAD_MIME_TYPES, ".pdf"].join(",");
const MAX_MB = Math.round(MAX_TICKET_UPLOAD_BYTES / (1024 * 1024));

export function TicketUpload({
  variant = "compact",
}: {
  variant?: "door" | "compact";
}) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [phase, setPhase] = React.useState<"idle" | "uploading">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const upload = React.useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setPhase("uploading");
      setError(null);
      // Extends the analytics already in the app (@vercel/analytics in the
      // root layout) rather than introducing a second system.
      track("ticket_upload_started", { variant });

      try {
        const body = new FormData();
        body.append("ticket", file);
        const response = await fetch("/api/ticket-uploads", { method: "POST", body });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          debug?: unknown;
        };

        // Present only when TICKET_EXTRACTION_DEBUG is set server-side. Parked
        // in sessionStorage so it survives the navigation below and never
        // rides along in the draft cookie.
        publishDebug(payload.debug);

        if (payload.ok) {
          track("ticket_upload_read", { variant });
          router.push("/book/flight?from=ticket");
          router.refresh();
          return;
        }

        track("ticket_upload_failed", { variant, status: response.status });

        if (RETRYABLE_STATUSES.has(response.status)) {
          // Their file, their fix. Staying here keeps "choose another one" a
          // single tap.
          setError(payload.error ?? "We couldn't accept that file.");
          return;
        }

        // We took the file and could not read it. Hand them the form rather
        // than a dead end — `read=failed` is what makes the page apologise
        // properly instead of showing a red banner.
        router.push("/book/flight?entry=manual&read=failed");
        router.refresh();
      } catch {
        publishDebug(undefined);
        track("ticket_upload_failed", { variant, status: 0 });
        router.push("/book/flight?entry=manual&read=failed");
        router.refresh();
      } finally {
        setPhase("idle");
        if (fileRef.current) fileRef.current.value = "";
        if (cameraRef.current) cameraRef.current.value = "";
      }
    },
    [router, variant],
  );

  const inputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Ticket PDF or photo"
        onChange={() => void upload(fileRef.current?.files?.[0])}
      />
      {/*
        A SECOND input purely for `capture`. One input cannot both open the
        camera and let somebody pick the PDF their airline emailed — `capture`
        makes a phone skip the file picker entirely — and a photo of a printed
        ticket is the most common thing a person has to hand.
      */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Photograph your ticket"
        onChange={() => void upload(cameraRef.current?.files?.[0])}
      />
    </>
  );

  if (variant === "compact") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload your e-ticket</CardTitle>
          <CardDescription>
            PDF or a photo — we&apos;ll read your flight details off it and fill in the
            form above for you to review.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {inputs}
          <Button
            type="button"
            variant="outline"
            loading={phase === "uploading"}
            onClick={() => fileRef.current?.click()}
          >
            {phase === "uploading" ? "Reading your ticket…" : "Upload ticket"}
          </Button>
          {error && <FormMessage variant="error">{error}</FormMessage>}
        </CardContent>
      </Card>
    );
  }

  const busy = phase === "uploading";

  return (
    <div className="flex flex-col gap-4">
      {inputs}

      {/*
        The drop area is a BUTTON, not a div with a click handler: it has to be
        reachable by keyboard and announce itself, and a bare div does neither.
        Drag-and-drop rides on top for the desktop case.
      */}
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        className={[
          "flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          busy
            ? "cursor-wait border-sky-300 bg-sky-50/60"
            : dragging
              ? "border-sky-500 bg-sky-50"
              : "border-navy-200 bg-card hover:border-sky-400 hover:bg-sky-50/40",
        ].join(" ")}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="size-8 animate-spin text-sky-600" />
        ) : (
          <FileUp aria-hidden="true" className="size-8 text-sky-600" />
        )}
        <span className="font-display text-lg font-semibold text-navy-800">
          {busy ? "Reading your ticket…" : "Upload your ticket"}
        </span>
        <span className="max-w-sm text-sm text-muted-foreground">
          {busy
            ? "This takes a few seconds. We'll show you everything we read before anything is saved."
            : `PDF or a photo — drop it here or tap to choose. Up to ${MAX_MB} MB.`}
        </span>
      </button>

      {/*
        Phones only. On a laptop `capture` is ignored and this would be a second
        button that opens the same picker as the one above it.
      */}
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={busy}
        className="sm:hidden"
        onClick={() => cameraRef.current?.click()}
      >
        <Camera aria-hidden="true" />
        Take a photo of your ticket
      </Button>

      {error && <FormMessage variant="error">{error}</FormMessage>}
    </div>
  );
}
