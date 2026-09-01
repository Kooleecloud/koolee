"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, ConfirmDialog, FormMessage } from "@koolee/ui";

import { cancelBookingAction } from "@/app/trips/[bookingId]/actions";

/**
 * Calling off a booking, from the customer's side.
 *
 * WHY IT IS SMALL AND AT THE BOTTOM. Cancelling is not what this page is for.
 * It is the thing a small number of people need on a page everybody else is
 * using to watch their bags arrive, so it gets one line and a quiet button
 * under everything else, rather than a card competing with the driver.
 *
 * WHY THE DIALOG STATES THE POLICY RATHER THAN ASKING "ARE YOU SURE".
 * "Are you sure?" is a speed bump; it tells somebody nothing they did not
 * already know and trains them to click through. What a person actually needs
 * at this moment is the one fact that changes soon: this is free NOW, and
 * after the window opens it goes through support. That is the sentence.
 *
 * WHY THERE IS NO OPTIMISTIC STATE. The refusal is a server decision — the
 * window may have opened while this page sat open — so the button waits for
 * the answer and the page re-renders against whatever the server decided.
 */
export function TripCancel({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const cancel = async () => {
    setError(null);
    setPending(true);
    try {
      const form = new FormData();
      form.set("bookingId", bookingId);
      const result = await cancelBookingAction({}, form);
      if (result.error) {
        setError(result.error);
        // The server already revalidated. Pulling the fresh render is what
        // takes the button away when the reason it refused is permanent.
        router.refresh();
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        {error ? <FormMessage variant="error">{error}</FormMessage> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Plans changed? You can cancel this pickup free until your window opens.
          </p>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" loading={pending}>
                Cancel booking
              </Button>
            }
            title="Cancel this pickup?"
            description={
              <>
                Cancelling now is free — the hold on your card is released and nothing is
                charged. Once your pickup window opens, cancelling goes through support
                instead.
              </>
            }
            confirmLabel="Yes, cancel it"
            cancelLabel="Keep my booking"
            destructive
            onConfirm={cancel}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What happened to a booking that is already cancelled, and who did it.
 *
 * The custody trail has recorded the actor since the state machine was
 * written; nothing rendered it. The difference matters to the person reading:
 * "you cancelled this" is a memory, and "Koolee cancelled this" is a question
 * that needs answering — so only the second one offers support.
 *
 * `system` gets the Koolee wording rather than a third variant. A cancellation
 * with no actor came from a job or a webhook, which is still Koolee as far as
 * the customer is concerned, and "cancelled automatically" is a fact about our
 * plumbing that answers nothing they asked.
 */
export function TripCancelledNotice({
  by,
  atLabel,
  reason,
}: {
  by: "customer" | "staff" | "system";
  /** Preformatted in the BOOKING's zone by the server. */
  atLabel: string;
  reason: string | null;
}) {
  const byYou = by === "customer";

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col gap-1 py-4">
        <p className="text-sm font-medium">
          {byYou ? `Cancelled by you on ${atLabel}` : `Cancelled by Koolee on ${atLabel}`}
        </p>
        <p className="text-sm text-muted-foreground">
          {byYou
            ? "Any hold on your card has been released. Nothing was charged for this pickup."
            : "If you were not expecting this, contact support and we will explain what happened."}
        </p>
        {/*
          The reason is shown only when Koolee cancelled. On a customer's own
          cancellation it is their own words read back to them, which is noise;
          on ours it is the only account they have of why.
        */}
        {!byYou && reason ? (
          <p className="text-sm text-muted-foreground">Reason given: {reason}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
