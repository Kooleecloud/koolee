"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, PackageCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
  Select,
  usePreservedFormValues,
} from "@koolee/ui";

import {
  confirmHandoverAction,
  deliverToBagdropAction,
  reportPickupExceptionAction,
  scanSealAction,
  startPickupTravelAction,
  type VisitActionState,
} from "./actions";

/**
 * The pickup run, guided. Replaces the "Not in the app yet" placeholder.
 *
 * Screen order matches the physical order: set off → scan every seal at the
 * door → drive → drop at the counter → confirm the airline took them. Each
 * step is one submit to a server action that appends the custody event; this
 * component renders progress derived from server state and nothing else.
 *
 * The steps render in sequence, but that is CONVENIENCE, not enforcement.
 * Core refuses a scan before the run has started, and refuses a delivery with
 * a bag never scanned — because a server action stays reachable as a POST
 * whatever this file chooses to draw.
 *
 * Retries are safe by construction: every underlying core function is
 * idempotent, so a driver in a basement car park who taps twice gets one
 * custody event and no error.
 */

export interface PickupBagView {
  id: string;
  /** The bag's number within the booking — matches the physical tag. */
  ordinal: number;
  sealId: string | null;
  scanned: boolean;
}

export interface PickupView {
  taskId: string;
  paxName: string;
  bookingRef: string;
  bookingStatus: string;
  departureAirport: string;
  /** The truck this run belongs to. Null when no driver has been chosen. */
  truckName: string | null;
  travelStarted: boolean;
  bags: PickupBagView[];
  done: boolean;
  exception: boolean;
}

const EXCEPTION_REASONS: { value: string; label: string }[] = [
  { value: "seal_mismatch", label: "A seal doesn't match the booking" },
  { value: "bag_count_mismatch", label: "Wrong number of bags at the door" },
  { value: "customer_not_home", label: "Nobody at the address" },
  { value: "vehicle_problem", label: "Vehicle problem" },
  { value: "bagdrop_refused", label: "Bag drop refused the bags" },
  { value: "other", label: "Something else" },
];

function useGps() {
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  React.useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setCoords(null),
      { enableHighAccuracy: false, timeout: 5_000 },
    );
  }, []);
  return coords;
}

function GpsFields({ coords }: { coords: { lat: number; lng: number } | null }) {
  if (!coords) return null;
  return (
    <>
      <input type="hidden" name="lat" value={coords.lat} />
      <input type="hidden" name="lng" value={coords.lng} />
    </>
  );
}

export function PickupFlow({ view }: { view: PickupView }) {
  const coords = useGps();

  if (view.exception) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Handed to ops</CardTitle>
          <CardDescription>
            You reported a problem on {view.bookingRef}. Ops has it — they will call you
            if they need anything else.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const scanned = view.bags.filter((bag) => bag.scanned).length;
  const allScanned = view.bags.length > 0 && scanned === view.bags.length;
  const delivered =
    view.bookingStatus === "delivered_to_bagdrop" || view.bookingStatus === "completed";

  return (
    <div className="flex flex-col gap-4">
      {view.truckName ? (
        <p className="text-sm text-muted-foreground">
          Running as <span className="font-medium">{view.truckName}</span>.
        </p>
      ) : null}

      <StepSetOff view={view} coords={coords} />

      {view.travelStarted ? (
        <StepSeals view={view} coords={coords} scanned={scanned} />
      ) : null}

      {allScanned && !delivered ? <StepDeliver view={view} coords={coords} /> : null}

      {delivered ? <StepHandover view={view} coords={coords} /> : null}

      {!view.done ? <ExceptionCard view={view} coords={coords} /> : null}
    </div>
  );
}

type Coords = { lat: number; lng: number } | null;

/* --- 1. set off ----------------------------------------------------- */

function StepSetOff({ view, coords }: { view: PickupView; coords: Coords }) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    startPickupTravelAction,
    {},
  );

  if (view.travelStarted) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check aria-hidden="true" className="size-4 text-success" />
        On the way to {view.paxName}.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Set off</CardTitle>
        <CardDescription>
          Tell {view.paxName} you&rsquo;re coming. From here your customer can see where
          you are and how long you&rsquo;ll be.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
        <form action={formAction}>
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            I&rsquo;m on the way
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* --- 2. seals at the door ------------------------------------------- */

function StepSeals({
  view,
  coords,
  scanned,
}: {
  view: PickupView;
  coords: Coords;
  scanned: number;
}) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    scanSealAction,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  const remaining = view.bags.length - scanned;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Check the seals
          <Badge variant={remaining === 0 ? "success" : "secondary"}>
            {scanned} of {view.bags.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {remaining === 0
            ? "Every bag checked. They're yours now."
            : `Scan or type the seal on each bag before you load it. ${remaining} left.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5">
          {view.bags.map((bag) => (
            <li key={bag.id} className="flex items-center gap-2 text-sm">
              {bag.scanned ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-4 shrink-0 rounded-full border border-navy-200"
                />
              )}
              <span className={bag.scanned ? "text-muted-foreground" : ""}>
                Bag {bag.ordinal}
              </span>
              {/* The seal id is NOT printed next to the checkbox. A driver who
                  can read the expected value off the screen is not checking
                  the bag, they are copying a number. */}
              {bag.scanned ? (
                <span className="ml-auto text-xs text-muted-foreground">checked</span>
              ) : null}
            </li>
          ))}
        </ul>

        {remaining > 0 ? (
          <>
            {state.error ? (
              <FormMessage variant="error">{state.error}</FormMessage>
            ) : null}
            <form
              ref={formRef}
              action={formAction}
              onSubmit={captureValues}
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="taskId" value={view.taskId} />
              <GpsFields coords={coords} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sealValue">Seal id</Label>
                <Input
                  id="sealValue"
                  name="sealValue"
                  placeholder="scan, or type the printed id"
                  autoComplete="off"
                  autoCapitalize="characters"
                  required
                />
                {/* TODO(agent-flow): camera QR/RFID scan, shared with the
                    verification step's capture. Manual entry ships first and
                    the seal id stays an opaque string either way. */}
              </div>
              <Button type="submit" size="lg" className="w-full" loading={pending}>
                Check this seal
              </Button>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* --- 3. the bag drop ------------------------------------------------ */

function StepDeliver({ view, coords }: { view: PickupView; coords: Coords }) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    deliverToBagdropAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">At the bag drop</CardTitle>
        <CardDescription>
          Tap this when you reach the {view.departureAirport} bag drop — before the
          airline takes them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
        <form action={formAction}>
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            I&rsquo;m at the bag drop
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* --- 4. the airline takes them -------------------------------------- */

function StepHandover({ view, coords }: { view: PickupView; coords: Coords }) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    confirmHandoverAction,
    {},
  );

  if (view.done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck aria-hidden="true" className="size-5 text-success" />
            Done
          </CardTitle>
          <CardDescription>
            {view.bookingRef} is closed out. {view.paxName} has been told.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hand over</CardTitle>
        <CardDescription>
          Only once the airline has actually taken the bags. If there&rsquo;s a queue or
          the counter is closed, wait — the customer can see you&rsquo;re there.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
        <form action={formAction}>
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            The airline has them
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* --- the way out ---------------------------------------------------- */

function ExceptionCard({ view, coords }: { view: PickupView; coords: Coords }) {
  const [state, formAction, pending] = useActionState<VisitActionState, FormData>(
    reportPickupExceptionAction,
    {},
  );
  const [open, setOpen] = React.useState(false);
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (!open) {
    return (
      <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        Something&rsquo;s wrong
      </Button>
    );
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">Report a problem</CardTitle>
        <CardDescription>
          This parks the booking with ops and stops the run. Use it rather than guessing —
          a wrong seal or a missing bag is never yours to sort out at a doorstep.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
        <form
          ref={formRef}
          action={formAction}
          onSubmit={captureValues}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="taskId" value={view.taskId} />
          <GpsFields coords={coords} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">What happened</Label>
            <Select id="reason" name="reason" defaultValue={EXCEPTION_REASONS[0]!.value}>
              {EXCEPTION_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">
              Anything else (required for &ldquo;something else&rdquo;)
            </Label>
            <Input id="note" name="note" autoComplete="off" />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              className="flex-1"
              loading={pending}
            >
              File it
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
