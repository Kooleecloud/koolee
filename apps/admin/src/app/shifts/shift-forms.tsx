"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, FormMessage, Input, Label, Select } from "@koolee/ui";

import {
  forceEndShiftAction,
  setCanDriveAction,
  startShiftOnBehalfAction,
  type ShiftAdminState,
} from "./actions";

export interface OnBehalfDriverView {
  staffUserId: string;
  label: string;
  /** The truck they are already out with, when there is one. */
  busyWith: string | null;
}

export interface OnBehalfTruckView {
  id: string;
  name: string;
  /** True when somebody's open shift already holds it. */
  held: boolean;
}

/**
 * Starting a shift FOR somebody.
 *
 * THE PAIR TO FORCE-END, and deliberately the quieter half. The console could
 * take a driver off the road and not put one back on: a dead phone, a locked
 * account or an app that would not load meant talking somebody through
 * starting their own shift, or the van stayed parked while every sealed
 * booking in that zone read "needs a driver".
 *
 * No reason box, unlike force-end. That one strands bags and raises
 * exceptions; this is routine dispatch, and demanding a justification for an
 * ordinary act trains people to type "x".
 *
 * INELIGIBLE OPTIONS ARE SHOWN, DISABLED, WITH THE REASON. A driver missing
 * from the list teaches nothing; "Nina Petrov — already out with Van A" is an
 * answer. Core refuses either way — the picker is a convenience and never the
 * guarantee — so the two cannot disagree about who is eligible.
 */
export function StartShiftOnBehalfForm({
  drivers,
  trucks,
}: {
  drivers: OnBehalfDriverView[];
  trucks: OnBehalfTruckView[];
}) {
  const [state, formAction, pending] = useActionState<ShiftAdminState, FormData>(
    startShiftOnBehalfAction,
    {},
  );

  const freeDriver = drivers.find((d) => d.busyWith === null);
  const freeTruck = trucks.find((t) => !t.held);

  if (drivers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody is cleared to drive yet. `can_drive` defaults to off — grant it below, and
        they become available here.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor="on-behalf-driver">Driver</Label>
        <Select
          id="on-behalf-driver"
          name="staffUserId"
          required
          defaultValue={freeDriver?.staffUserId ?? ""}
        >
          {drivers.map((driver) => (
            <option
              key={driver.staffUserId}
              value={driver.staffUserId}
              disabled={driver.busyWith !== null}
            >
              {driver.label}
              {driver.busyWith ? ` — already out with ${driver.busyWith}` : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex min-w-44 flex-col gap-1.5">
        <Label htmlFor="on-behalf-truck">Truck</Label>
        <Select
          id="on-behalf-truck"
          name="truckId"
          required
          defaultValue={freeTruck?.id ?? ""}
        >
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id} disabled={truck.held}>
              {truck.name}
              {truck.held ? " — out" : ""}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" loading={pending} disabled={!freeDriver || !freeTruck}>
        Start shift
      </Button>

      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
    </form>
  );
}

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
