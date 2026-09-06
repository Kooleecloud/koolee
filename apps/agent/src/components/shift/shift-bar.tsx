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
  const location = useLocationReadiness();

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

          {/*
            THE GATE. A shift that starts with location off runs blind for its
            whole length: the driver sees nothing wrong, every customer on
            their route sees "Locating…", and the first anybody hears of it is
            a support call. Thirty seconds before the van moves is the only
            moment this is cheap to fix.

            It is a PROMPT, not a lock, and the button stays live throughout.
            Refusing to let somebody clock on would strand a driver whose phone
            is having a bad morning at a doorstep with bags waiting, which is a
            worse failure than a missing pin. What it does is make the cost
            legible and the fix one tap away.
          */}
          {location.state !== "ready" && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-navy-700">
              <span>
                {location.state === "denied"
                  ? "Location is off for this site. Start your shift and your customers won't see you coming — turn it on in your browser settings."
                  : location.state === "unsupported"
                    ? "This device can't share a location. Everything else works; your customers just won't see you moving."
                    : "Koolee needs your location so customers can watch you arrive."}
              </span>
              {location.state === "prompt" && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={location.request}
                  loading={location.asking}
                >
                  Turn on location
                </Button>
              )}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Start shift
          </Button>
        </form>
      )}
    </Card>
  );
}

type LocationState = "checking" | "prompt" | "ready" | "denied" | "unsupported";

/**
 * Whether this device is ready to report a position, asked BEFORE the shift
 * rather than discovered during it.
 *
 * WHY IT IS HERE AND NOT IN `GpsPinger`. The pinger only mounts once a shift
 * is open, so by the time it discovers a denied permission the driver is on
 * the clock, possibly already driving, and the customer's page has already
 * said "Locating…" for a while. The permission question has one cheap moment
 * and this is it.
 *
 * READS THE PERMISSION WITHOUT ASKING FOR IT. `permissions.query` does not
 * prompt, so a driver who has already granted location sees nothing at all —
 * no banner, no button, no interruption to the one screen they use most. The
 * prompt is only offered to somebody who has not answered yet, and asking is
 * their tap, never ours: a permission dialog nobody expected is the surest way
 * to get a permanent "block".
 *
 * FIREFOX AND OLDER SAFARI have no `permissions.query` for geolocation. They
 * land on "prompt" and get the offer, which is the right default — the worst
 * case is a driver who already granted it seeing one extra button.
 */
function useLocationReadiness(): {
  state: LocationState;
  asking: boolean;
  request: () => void;
} {
  const [state, setState] = React.useState<LocationState>("checking");
  const [asking, setAsking] = React.useState(false);

  React.useEffect(() => {
    /*
     * Deferred rather than set synchronously, the house pattern here: a
     * setState in the body of an effect cascades a second render before
     * paint, and the lint rule that catches it is right.
     */
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const timer = setTimeout(() => setState("unsupported"), 0);
      return () => clearTimeout(timer);
    }
    if (!navigator.permissions?.query) {
      const timer = setTimeout(() => setState("prompt"), 0);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    let detach: (() => void) | null = null;

    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        const apply = () =>
          setState(
            result.state === "granted"
              ? "ready"
              : result.state === "denied"
                ? "denied"
                : "prompt",
          );
        apply();
        result.addEventListener("change", apply);
        detach = () => result.removeEventListener("change", apply);
      })
      .catch(() => setState("prompt"));

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  const request = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setAsking(true);
    /*
     * ONE REAL FIX, not just the permission. A granted permission on a phone
     * that cannot actually see the sky is still a shift that reports nothing,
     * and the difference matters most indoors — a loading bay, a basement car
     * park — which is exactly where a driver clocks on.
     */
    navigator.geolocation.getCurrentPosition(
      () => {
        setAsking(false);
        setState("ready");
      },
      (error) => {
        setAsking(false);
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "prompt");
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  return { state, asking, request };
}
