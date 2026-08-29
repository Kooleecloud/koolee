"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, FormMessage, Input, Label } from "@koolee/ui";

import { forceEndShiftAction, setCanDriveAction, type ShiftAdminState } from "./actions";

/**
 * Force-ending somebody else's shift.
 *
 * Two-step on purpose: the button opens a reason box rather than acting. This
 * is destructive to a run in progress — every open pickup on the shift goes
 * back in the pool and anything already in transit becomes an exception — and
 * the reason it needs is not a formality, it is written into the custody trail
 * of every booking it touches.
 */
export function ForceEndShiftForm({
  shiftId,
  driverName,
  bagsOnBoard,
}: {
  shiftId: string;
  driverName: string;
  bagsOnBoard: number;
}) {
  const [state, formAction, pending] = useActionState<ShiftAdminState, FormData>(
    forceEndShiftAction,
    {},
  );
  const [open, setOpen] = React.useState(false);

  if (state.ok) return <FormMessage variant="success">{state.ok}</FormMessage>;

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Force end
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`reason-${shiftId}`}>
          Why are you ending {driverName}&rsquo;s shift?
        </Label>
        <Input
          id={`reason-${shiftId}`}
          name="reason"
          placeholder="Van broke down on the BQE"
          required
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground">
          {bagsOnBoard > 0
            ? `${bagsOnBoard} bag${bagsOnBoard === 1 ? "" : "s"} on board will go back in the pool. Anything already in transit becomes an exception.`
            : "Nothing is on this truck."}{" "}
          This reason is written into the custody trail of every booking it touches.
        </p>
      </div>
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" loading={pending}>
          End the shift
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Grant or revoke the driving capability from the shifts board. */
export function CanDriveToggle({
  userId,
  name,
  canDrive,
}: {
  userId: string;
  name: string;
  canDrive: boolean;
}) {
  const [state, formAction, pending] = useActionState<ShiftAdminState, FormData>(
    setCanDriveAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="canDrive" value={canDrive ? "false" : "true"} />
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        {canDrive ? `Revoke driving for ${name}` : `Clear ${name} to drive`}
      </Button>
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
    </form>
  );
}
