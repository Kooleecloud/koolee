"use client";

import * as React from "react";
import { useActionState } from "react";
import { Truck } from "lucide-react";
import { Button, FormMessage, Popover, PopoverContent, PopoverTrigger } from "@koolee/ui";

import { endShiftAction, type ShiftActionState } from "@/app/shift-actions";

import { StartShiftForm, type ActiveShiftView, type TruckOptionView } from "./shift-bar";

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
 * BOTH HALVES LIVE HERE. The first version left clocking ON as a card at the
 * top of Today, on the reasoning that a truck picker and a location gate are
 * too important to bury in a header popover. TD's call is symmetry, and it is
 * a fair one: a driver should look in ONE place to clock on or off rather than
 * learning that the two live on different surfaces. The cost is
 * discoverability — a pill is smaller than a full-width card — so the
 * off-shift pill says "Start shift" in words rather than trusting an icon.
 */
export function ShiftPill({
  active,
  trucks,
}: {
  active: ActiveShiftView | null;
  trucks: TruckOptionView[];
}) {
  return active ? <OnShiftPill active={active} /> : <OffShiftPill trucks={trucks} />;
}

/**
 * Not working yet: the truck, the gate, and the button, behind a tap.
 */
function OffShiftPill({ trucks }: { trucks: TruckOptionView[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-shift-state="off"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-navy-700 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <Truck aria-hidden="true" className="size-3 shrink-0" />
          Start shift
        </button>
      </PopoverTrigger>
      {/*
        WIDER THAN THE ON-SHIFT PANEL because it holds a select and a gate
        rather than three lines of text. `align="end"` keeps it inside the
        viewport on a 390px screen, where a centred popover under a
        right-hand trigger would hang off the edge.
      */}
      <PopoverContent align="end" className="w-80">
        <p className="font-medium">Not on shift</p>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Pick your truck to clock on. Customers can only be offered a driver who is out.
        </p>
        <StartShiftForm trucks={trucks} />
      </PopoverContent>
    </Popover>
  );
}

function OnShiftPill({ active }: { active: ActiveShiftView }) {
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
