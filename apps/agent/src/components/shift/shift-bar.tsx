"use client";

import * as React from "react";
import { useActionState } from "react";
import { Truck } from "lucide-react";
import { Badge, Button, Card, FormMessage, Label, Select } from "@koolee/ui";

import {
  endShiftAction,
  startShiftAction,
  type ShiftActionState,
} from "@/app/shift-actions";

/**
 * Clock on, clock off — the first thing a driver touches and the last.
 *
 * It lives at the top of Today rather than behind a fourth tab. The nav's own
 * comment (`components/shell/nav.ts`) argues three tabs is the ceiling — what
 * am I doing now, what is coming, who am I — and a shift is not a fourth
 * destination, it is the state the first tab is in.
 *
 * Only rendered for staff cleared to drive. That is convenience, not
 * enforcement: `startShift` refuses on the server for anybody else.
 */

export interface TruckOptionView {
  id: string;
  name: string;
  bagCapacity: number;
  /** Out with somebody else right now. Shown, never hidden — see below. */
  unavailable: boolean;
}

export interface ActiveShiftView {
  truckName: string;
  bagCapacity: number;
  bagsOnBoard: number;
  /** Preformatted, airport-local. */
  startedAtLabel: string;
}

export function ShiftBar({
  active,
  trucks,
}: {
  active: ActiveShiftView | null;
  trucks: TruckOptionView[];
}) {
  return active ? <OnShift active={active} /> : <OffShift trucks={trucks} />;
}

function OnShift({ active }: { active: ActiveShiftView }) {
  const [state, formAction, pending] = useActionState<ShiftActionState, FormData>(
    endShiftAction,
    {},
  );
  const remaining = active.bagCapacity - active.bagsOnBoard;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Truck aria-hidden="true" className="size-4 shrink-0 text-navy-500" />
        <span className="font-medium">{active.truckName}</span>
        <Badge variant="success">On shift</Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {active.bagsOnBoard} of {active.bagCapacity}{" "}
        {active.bagCapacity === 1 ? "space" : "spaces"} used · room for {remaining} more{" "}
        {remaining === 1 ? "bag" : "bags"} · started {active.startedAtLabel}
      </p>

      {/* The blocked-end message names the bookings still on the truck — it
          arrives from core already written for a driver, so it is shown as-is. */}
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}

      <form action={formAction}>
        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="w-full"
          loading={pending}
        >
          End shift
        </Button>
      </form>
    </Card>
  );
}

function OffShift({ trucks }: { trucks: TruckOptionView[] }) {
  const [state, formAction, pending] = useActionState<ShiftActionState, FormData>(
    startShiftAction,
    {},
  );
  const free = trucks.filter((t) => !t.unavailable);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Truck aria-hidden="true" className="size-4 shrink-0 text-navy-500" />
        <span className="font-medium">Not on shift</span>
      </div>

      {trucks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No trucks are set up yet. Ops adds them in the console.
        </p>
      ) : free.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every truck is out right now. Check with ops before starting.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="truckId">Truck</Label>
            <Select id="truckId" name="truckId" defaultValue={free[0]?.id}>
              {/* Trucks already out are listed and DISABLED rather than
                  omitted: a driver who cannot find their van in the list
                  learns nothing, where a greyed-out one is an answer. */}
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id} disabled={truck.unavailable}>
                  {truck.name}
                  {truck.unavailable ? " — out with another driver" : ""}
                </option>
              ))}
            </Select>
          </div>

          {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}

          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Start shift
          </Button>
        </form>
      )}
    </Card>
  );
}
