"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@koolee/ui";

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

  const legal = new Set(legalEvents);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="grid gap-2">
        <Label htmlFor="note">Reason (recorded in the custody log)</Label>
        <Input id="note" name="note" placeholder="e.g. driver confirmed by phone" />
      </div>

      <div className="flex flex-wrap gap-2">
        {events.map((event) => (
          <Button
            key={event}
            type="submit"
            name="event"
            value={event}
            disabled={pending}
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
        ))}
      </div>

      {state.error && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{state.error}</span>
          {state.allowed && state.allowed.length > 0 && (
            <span className="text-xs opacity-80">
              Legal from here: {state.allowed.join(", ")}
            </span>
          )}
        </div>
      )}

      {state.ok && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
          {state.ok}
        </p>
      )}
    </form>
  );
}
