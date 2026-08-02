"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, FormMessage, Input, Label, toast } from "@koolee/ui";

import { manualTransition, type TransitionActionState } from "@/app/bookings/actions";

/**
 * Manual state-transition buttons.
 *
 * Every event in the state machine is rendered, not just the legal ones. That
 * is deliberate: an operator clicking an impossible move gets the typed error
 * back — including which moves *are* legal — which is more useful than a button
 * that silently is not there.
 */
export function TransitionControls({
  bookingId,
  events,
  legalEvents,
}: {
  bookingId: string;
  events: string[];
  legalEvents: string[];
}) {
  const [state, formAction, pending] = useActionState<TransitionActionState, FormData>(
    manualTransition,
    {},
  );
  /** Which event button fired the in-flight submit — it spins, the rest grey out. */
  const [submitted, setSubmitted] = useState<string | null>(null);
  /** Hidden submitter for `cancel`, fired from the confirm dialog. */
  const cancelSubmitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.ok) toast.success(state.ok);
  }, [state]);

  const legal = new Set(legalEvents);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="grid gap-2">
        <Label htmlFor="note">Reason (recorded in the custody log)</Label>
        <Input id="note" name="note" placeholder="e.g. driver confirmed by phone" />
      </div>

      <div className="flex flex-wrap gap-2">
        {events.map((event) =>
          event === "cancel" ? (
            <ConfirmDialog
              key={event}
              destructive
              title="Cancel this booking?"
              description="This writes to the append-only custody log and cannot be undone."
              confirmLabel="Cancel booking"
              trigger={
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  loading={pending && submitted === event}
                  disabled={pending && submitted !== event}
                  title={
                    legal.has(event)
                      ? `Legal from the current status`
                      : `Not legal from the current status — clicking will show why`
                  }
                >
                  {event}
                </Button>
              }
              onConfirm={() => {
                setSubmitted(event);
                cancelSubmitRef.current?.form?.requestSubmit(cancelSubmitRef.current);
              }}
            />
          ) : (
            <Button
              key={event}
              type="submit"
              name="event"
              value={event}
              onClick={() => setSubmitted(event)}
              loading={pending && submitted === event}
              disabled={pending && submitted !== event}
              variant={legal.has(event) ? "default" : "outline"}
              size="sm"
              title={
                legal.has(event)
                  ? `Legal from the current status`
                  : `Not legal from the current status — clicking will show why`
              }
            >
              {event}
            </Button>
          ),
        )}
      </div>

      {/* Submitter for the confirmed cancel — keeps the same form/action wiring. */}
      <button
        ref={cancelSubmitRef}
        type="submit"
        name="event"
        value="cancel"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {state.error && (
        <FormMessage variant="error">
          <span className="flex flex-col gap-1">
            <span>{state.error}</span>
            {state.allowed && state.allowed.length > 0 && (
              <span className="text-xs opacity-80">
                Legal from here: {state.allowed.join(", ")}
              </span>
            )}
          </span>
        </FormMessage>
      )}
    </form>
  );
}
