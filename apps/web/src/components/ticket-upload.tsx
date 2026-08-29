"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
} from "@koolee/ui";

import {
  TICKET_DEBUG_EVENT,
  TICKET_DEBUG_KEY,
} from "@/components/ticket-extraction-debug";

/**
 * Ticket upload → /api/ticket-uploads (server-side storage + extraction).
 *
 * What comes back only PREFILLS the flight review form above — the customer
 * always reviews, edits, and confirms there before anything is persisted.
 * On failure the message points at manual entry and nothing else changes.
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

export function TicketUpload() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [phase, setPhase] = React.useState<"idle" | "uploading">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function onFileChosen() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setPhase("uploading");
    setError(null);

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
      // in sessionStorage so it survives the navigation below and never rides
      // along in the draft cookie.
      publishDebug(payload.debug);

      if (payload.ok) {
        // The extraction landed in the quarantined prefill; re-render the
        // review form with it.
        router.push("/book/flight?from=ticket");
        router.refresh();
        return;
      }
      setError(
        payload.error ??
          "We couldn't read this — please enter your flight details manually.",
      );
    } catch {
      publishDebug(undefined);
      setError("Upload failed — please enter your flight details manually.");
    } finally {
      setPhase("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload your e-ticket</CardTitle>
        <CardDescription>
          PDF or a photo — we&apos;ll read your flight details off it and fill in the form
          above for you to review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png"
          className="sr-only"
          aria-label="Ticket PDF"
          onChange={onFileChosen}
        />
        <Button
          type="button"
          variant="outline"
          loading={phase === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {phase === "uploading" ? "Reading your ticket…" : "Upload ticket"}
        </Button>

        {error && <FormMessage variant="error">{error}</FormMessage>}
      </CardContent>
    </Card>
  );
}
