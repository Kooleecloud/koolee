"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  FormMessage,
  Input,
  Label,
  Select,
  toast,
} from "@koolee/ui";

import { manualTransition, type TransitionActionState } from "@/app/bookings/actions";

/**
 * Manual state override: pick a move, say why, apply.
 *
 * Every event in the state machine stays pickable, not just the legal ones —
 * that is the original deliberate choice and it survives the redesign. An
 * operator who picks an impossible move gets the typed error back, including
 * which moves ARE legal, which is more useful than an option that quietly is
 * not there. What changed is the shape: eleven buttons spread across the card
 * read as eleven things to do, when it is really one action with a parameter.
 * The optgroups carry the legality signal the button variants used to.
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
  const [event, setEvent] = useState(legalEvents[0] ?? "");
  /** Hidden submitter, fired from the confirm dialog. */
  const confirmSubmitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.ok) toast.success(state.ok);
  }, [state]);

  const illegal = event !== "" && !legal.has(event);
  const other = events.filter((e) => !legal.has(e));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="grid gap-2">
        <Label htmlFor="event">Move</Label>
        <Select
          id="event"
          name="event"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          required
        >
          <option value="" disabled>
            Pick a move…
          </option>
          {legalEvents.length > 0 && (
            <optgroup label="Allowed now">
              {legalEvents.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </optgroup>
          )}
          {other.length > 0 && (
            <optgroup label="Not legal from here">
              {other.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {illegal && (
          <p className="text-xs text-muted-foreground">
            Not legal from the current status — applying will show why.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="note">Reason (recorded in the custody log)</Label>
        <Input id="note" name="note" placeholder="e.g. driver confirmed by phone" />
      </div>

      {event === "cancel" ? (
        <ConfirmDialog
          destructive
          title="Cancel this booking?"
          description="This writes to the append-only custody log and cannot be undone."
          confirmLabel="Cancel booking"
          trigger={
            <Button type="button" variant="destructive" loading={pending}>
              Apply override
            </Button>
          }
          onConfirm={() =>
            confirmSubmitRef.current?.form?.requestSubmit(confirmSubmitRef.current)
          }
        />
      ) : (
        <Button type="submit" loading={pending} disabled={event === ""}>
          Apply override
        </Button>
      )}

      {/* Submitter for the confirmed cancel — same form, same action. */}
      <button
        ref={confirmSubmitRef}
        type="submit"
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
