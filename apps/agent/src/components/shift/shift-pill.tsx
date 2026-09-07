"use client";

import * as React from "react";
import { useActionState } from "react";
import { Truck } from "lucide-react";
import { Button, FormMessage, Popover, PopoverContent, PopoverTrigger } from "@koolee/ui";

import { endShiftAction, type ShiftActionState } from "@/app/shift-actions";

import type { ActiveShiftView } from "./shift-bar";

/**
 * "On shift" in the header, with everything behind a tap.
 *
 * WHY IT MOVED OUT OF THE PAGE. The shift card sat at the top of Today: a
 * truck name, a capacity line, a start time and an End shift button, all
 * permanently on screen. Three of those four are things a driver checks
 * occasionally and one is a thing they press twice a day, and together they
 * took the top of the only screen they use while working. Worse, they were on
 * Today ALONE — a driver deep in a task could not see whether they were even
 * clocked on.
 *
 * So the fact lives in the header, where it is visible from every screen, and
 * the detail lives behind it. TD's framing: the tag on top, "all the metadata
 * upon click only".
 *
 * END SHIFT STAYS BEHIND THE TAP TOO, and that is a small safety win rather
 * than an accident: it used to be a full-width button under a driver's thumb
 * on the screen they look at most. Now it takes a deliberate open first.
 *
 * OFF SHIFT, THIS RENDERS NOTHING. Starting a shift needs a truck picker and
 * the location gate, and it is the whole point of Today when nobody is
 * working — burying that in a header popover would hide the one action that
 * matters. `ShiftBar` keeps it.
 */
export function ShiftPill({ active }: { active: ActiveShiftView }) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState<ShiftActionState, FormData>(
    endShiftAction,
    {},
  );
  const remaining = active.bagCapacity - active.bagsOnBoard;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-shift-state="on"
          className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-1 text-[11px] font-medium text-navy-800 transition-colors hover:bg-success/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <Truck aria-hidden="true" className="size-3 shrink-0" />
          On shift
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="font-medium">{active.truckName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.bagsOnBoard} of {active.bagCapacity}{" "}
          {active.bagCapacity === 1 ? "space" : "spaces"} used · room for {remaining} more{" "}
          {remaining === 1 ? "bag" : "bags"}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Started {active.startedAtLabel}
        </p>

        {/* The blocked-end message names the bookings still on the truck — it
            arrives from core already written for a driver, so it is shown
            as-is. Kept INSIDE the popover: a refusal has to appear where the
            button that caused it is. */}
        {state.error ? (
          <div className="mt-3">
            <FormMessage variant="error">{state.error}</FormMessage>
          </div>
        ) : null}

        <form action={formAction} className="mt-3">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="w-full"
            loading={pending}
          >
            End shift
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
