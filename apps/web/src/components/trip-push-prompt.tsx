"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button, Card, CardContent, useWebPush } from "@koolee/ui";

/**
 * "Get live pickup updates" — the customer-side push prompt.
 *
 * SOFT, LATE, AND DISMISSIBLE, in that order. The staff apps put an enable
 * button on a settings page because staff have decided they want the app.
 * A customer has not: they booked a pickup once and may never open this page
 * again. So this card:
 *
 *  - is never shown in the funnel and never on page load anywhere else;
 *  - appears ONLY once the pickup is close (the server decides — see
 *    `withinPushPromptWindow`), when "we'll tell you when your driver is
 *    outside" is an offer rather than an interruption;
 *  - is dismissed permanently per booking, in `localStorage`;
 *  - never asks for permission by itself. The browser prompt only ever opens
 *    from the button, because permission is one-shot: a dismissed prompt does
 *    not come back and the customer would have to dig into site settings to
 *    undo it.
 *
 * WHEN IT SAYS NOTHING. On a platform that cannot do this — iOS Safari that
 * has not been added to the Home Screen is the common one — the card renders
 * nothing at all rather than offering a button that cannot work. Telling a
 * customer to install a PWA so they can receive a notification is a worse
 * experience than the email they are already getting.
 */

export interface TripPushPromptProps {
  bookingId: string;
}

function dismissKey(bookingId: string): string {
  return `koolee.push-prompt-dismissed.${bookingId}`;
}

export function TripPushPrompt({ bookingId }: TripPushPromptProps) {
  const push = useWebPush({
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  });
  // Starts hidden and is revealed by an effect: reading localStorage during
  // render would disagree with the server HTML and trip a hydration mismatch.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const read = async (): Promise<void> => {
      let value: boolean;
      try {
        value = window.localStorage.getItem(dismissKey(bookingId)) === "1";
      } catch {
        // Private mode, or storage disabled. Showing the card is the right
        // failure: it is dismissible, so the cost of getting this wrong is
        // one more tap.
        value = false;
      }
      if (!cancelled) setDismissed(value);
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(bookingId), "1");
    } catch {
      // Dismissal not remembered. It still went away for this visit.
    }
  };

  // `ready` gates the whole thing so the card never flashes in and out while
  // capability detection runs.
  if (!push.ready || dismissed || push.subscribed) return null;
  // No honest offer to make: an unsupported platform, a denied permission the
  // browser will never re-ask about, or an environment with no VAPID key.
  if (!push.supported || push.permission === "denied") return null;

  return (
    <Card className="border-sky-300 bg-sky-50">
      <CardContent className="flex items-start gap-3 py-4">
        <BellRing aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sky-600" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm font-medium text-navy-800">Get live pickup updates</p>
          <p className="text-sm text-muted-foreground">
            We&apos;ll let you know when your agent is assigned, when your bags are
            sealed, and when they reach the bag drop — without keeping this page open.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void push.subscribe()} disabled={push.busy}>
              {push.busy ? "Turning on…" : "Turn on updates"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
          {push.error ? (
            <p className="text-sm text-destructive" role="alert">
              {push.error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-sky-100"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </CardContent>
    </Card>
  );
}
