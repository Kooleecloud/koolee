"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  LiveMap,
  ProgressTrack,
} from "@koolee/ui";

import {
  selectDriverAction,
  type SelectDriverState,
} from "@/app/trips/[bookingId]/actions";
import { PICKUP_STEPS } from "@/lib/pickup-progress";

/**
 * The customer's driver: choosing one, then watching them come.
 *
 * Three states, in the order a customer meets them:
 *
 *  1. a shortlist to choose from — up to four, emptiest van first;
 *  2. nothing to offer, which says a driver is being assigned (and pages ops
 *     behind the scenes) rather than showing an empty list;
 *  3. a chosen driver, their distance, their ETA and where the bags are.
 *
 * THERE IS A MAP NOW, and the old note here said there deliberately was not:
 * "a distance and an updating ETA answer the actual question — how long until
 * somebody knocks". That was half right. The other question somebody sitting
 * with sealed bags is asking is "is anything actually happening", and a number
 * that changes every 45 seconds answers it worse than a pin that moves.
 *
 * The map is `LiveMap` in @koolee/ui — MapLibre over OpenFreeMap tiles, no key
 * and no per-load billing, deliberately not Google's Maps JS (a separate SKU
 * needing a browser-side key, where every Maps call this product makes today
 * is server-side). It NEVER gates: a tile host that is down, or a browser with
 * no WebGL, leaves the list and the ETA below it untouched.
 *
 * CHOOSING IS STILL A LIST DECISION. The pins are a second way to reach the
 * same four cards — click a pin, its card highlights and scrolls into view —
 * because a name, a van's remaining capacity and an ETA do not fit in a map
 * pin, and those are what somebody actually chooses on.
 */

export interface DriverCandidateView {
  shiftId: string;
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  /** Room left on that van after this booking's bags. */
  availableCapacity: number;
  outOfZone: boolean;
  /** Preformatted by `formatEtaMinutes` — "about 25 min" or "ETA on the way". */
  etaLabel: string;
  /** True when the ETA is a real estimate rather than the fallback phrase. */
  hasEta: boolean;
  /**
   * Last known position, for the map. Null is ordinary — a phone in a pocket
   * stops reporting — and such a driver simply has no pin while keeping their
   * card, because they are still perfectly choosable.
   */
  position: { lat: number; lng: number } | null;
}

export interface SelectedDriverView {
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  etaLabel: string;
  /** Miles, e.g. "3.2 miles away". Null when the driver has not pinged. */
  distanceLabel: string | null;
  /** Airport-local, preformatted. Null when there is no position yet. */
  lastSeenLabel: string | null;
  /** Where the bags are, as a milestone index into `PICKUP_STEPS`. */
  stepIndex: number;
  /** Where they are right now. Null until the first ping. */
  position: { lat: number; lng: number } | null;
}

/* ------------------------------------------------------------------ */
/* 1. Choosing                                                          */
/* ------------------------------------------------------------------ */

export function DriverChoice({
  bookingId,
  candidates,
  pickup,
}: {
  bookingId: string;
  candidates: DriverCandidateView[];
  /** The door, for the map. Null when the address has no coordinates. */
  pickup: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SelectDriverState, FormData>(
    selectDriverAction,
    {},
  );
  /**
   * Which pin was clicked. PURELY A HIGHLIGHT — it commits nothing.
   *
   * Choosing a driver is irreversible (the pickup task is claimed and the
   * shortlist closes), so a click on a map pin must never be the click that
   * does it. Tapping a pin highlights its card and brings it into view; the
   * card's own button is what chooses.
   */
  const [focused, setFocused] = React.useState<string | null>(null);
  const cardRefs = React.useRef(new Map<string, HTMLLIElement>());

  // A lost race is not a dead end. `revalidatePath` already ran server-side;
  // this pulls the refreshed shortlist so the customer's next click is a
  // different driver rather than a retry of the one who just filled up.
  useEffect(() => {
    if (state.stale) router.refresh();
  }, [state.stale, router]);

  if (candidates.length === 0) return <NoDriverYet />;

  const allOutOfZone = candidates.every((c) => c.outOfZone);
  const pins = candidates
    .filter((candidate) => candidate.position !== null)
    .map((candidate) => ({
      id: candidate.shiftId,
      position: candidate.position!,
      label: candidate.givenName,
      selected: focused === candidate.shiftId,
    }));

  const onPinClick = (shiftId: string) => {
    setFocused(shiftId);
    cardRefs.current
      .get(shiftId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Choose your driver</CardTitle>
        <CardDescription>
          {allOutOfZone
            ? "Everyone close by is full right now, so these drivers are coming from a little further out — they will take a bit longer to reach you."
            : "Your bags are sealed and ready. Pick whoever suits you; they will collect your bags and deliver them to your airline's bag drop."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}

        {/* Drawn only when we know where the door is. A map of vans with no
            reference point is worse than no map. */}
        {pickup && pins.length > 0 && (
          <>
            <LiveMap
              pickup={pickup}
              drivers={pins}
              onDriverClick={onPinClick}
              className="h-64 sm:h-72"
              label={`Map showing your pickup address and ${pins.length} available ${
                pins.length === 1 ? "driver" : "drivers"
              }`}
            />
            <p className="text-xs text-muted-foreground">
              Tap a van to see who it is. You choose below — nothing is booked from
              the map.
            </p>
          </>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.shiftId}
              ref={(node) => {
                if (node) cardRefs.current.set(candidate.shiftId, node);
                else cardRefs.current.delete(candidate.shiftId);
              }}
            >
              <form action={formAction}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="shiftId" value={candidate.shiftId} />
                <div
                  className={
                    focused === candidate.shiftId
                      ? "flex h-full flex-col gap-3 rounded-lg border border-tag-400 bg-tag-50/60 p-4 ring-1 ring-tag-300"
                      : "flex h-full flex-col gap-3 rounded-lg border border-border p-4"
                  }
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      size="md"
                      name={candidate.givenName}
                      src={candidate.avatarUrl}
                      alt=""
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {candidate.givenName ?? "Koolee driver"}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {candidate.truckName}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={candidate.hasEta ? "default" : "secondary"}>
                      {candidate.etaLabel}
                    </Badge>
                    {candidate.outOfZone ? (
                      <Badge variant="secondary">Coming from further out</Badge>
                    ) : null}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Room for {candidate.availableCapacity} more{" "}
                    {candidate.availableCapacity === 1 ? "bag" : "bags"} after yours.
                  </p>

                  <Button type="submit" className="mt-auto w-full" loading={pending}>
                    Choose {candidate.givenName ?? "this driver"}
                  </Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Nothing to offer.
 *
 * It does NOT say "no drivers available" — that is a Koolee staffing problem
 * described to the customer as their problem, and there is nothing they can do
 * with it. The page tells them what will happen; the ops alert (raised
 * server-side, once an hour at most) is what makes that sentence true.
 */
function NoDriverYet() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">
          We&rsquo;re assigning your driver
        </CardTitle>
        <CardDescription>
          Your bags are sealed and ready to go. We&rsquo;re matching you with a driver
          now — you&rsquo;ll get a confirmation as soon as they&rsquo;re on it.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Watching                                                          */
/* ------------------------------------------------------------------ */

/**
 * REFRESH IS NOT THIS COMPONENT'S JOB ANY MORE.
 *
 * This used to own a 30-second `setInterval(router.refresh)`, which made the
 * page live only once a driver had been chosen — an agent sealing bags on the
 * doorstep changed nothing on the screen the customer was watching. `TripLive`
 * now sits at page level and refreshes on a `booking_signals` change (with the
 * same interval as its fallback), so everything on the page updates, not one
 * card. Do not re-add a timer here.
 */
export function DriverTracking({
  driver,
  /** False once the bags are delivered — nothing left to track. */
  live,
  /** The door, for the map. Null when the address has no coordinates. */
  pickup,
}: {
  driver: SelectedDriverView;
  live: boolean;
  pickup: { lat: number; lng: number } | null;
}) {
  /*
   * THE MAP IS ONLY FOR A JOURNEY IN PROGRESS. Once the bags are at the bag
   * drop there is no van to watch, and a map of where somebody was is not a
   * receipt — the custody timeline is. Also gated on having both ends: a pin
   * with no reference point tells nobody anything.
   */
  const showMap = live && pickup !== null && driver.position !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Your driver</CardTitle>
        <CardDescription>
          {live
            ? "Updating as your driver moves."
            : "Your bags are with your airline now."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar size="lg" name={driver.givenName} src={driver.avatarUrl} alt="" />
          <div className="min-w-0">
            <p className="font-medium">{driver.givenName ?? "Your Koolee driver"}</p>
            <p className="text-sm text-muted-foreground">{driver.truckName}</p>
          </div>
          {live ? (
            <div className="ml-auto text-right">
              <p className="font-display text-lg">{driver.etaLabel}</p>
              <p className="text-sm text-muted-foreground">
                {driver.distanceLabel ?? "Position updating"}
              </p>
            </div>
          ) : null}
        </div>

        {showMap && (
          <LiveMap
            pickup={pickup}
            drivers={[
              {
                // One driver, and the id is stable for the life of the card,
                // so the pin MOVES between refreshes instead of being torn
                // down and re-added. That is what makes a van look like it is
                // driving rather than teleporting.
                id: "selected",
                position: driver.position!,
                label: driver.givenName,
                selected: true,
              },
            ]}
            className="h-64 sm:h-72"
            label={`Map showing ${driver.givenName ?? "your driver"} on the way to your pickup address`}
          />
        )}

        <PickupProgress stepIndex={driver.stepIndex} />

        {live && driver.lastSeenLabel ? (
          <p className="text-xs text-muted-foreground">
            Location last updated {driver.lastSeenLabel}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Where the bags are, as a track with a current position.
 *
 * This used to be a local component drawing its own dots and rails —
 * `size-2.5`, `bg-sky-500` for done and `bg-navy-200` for not, a hairline
 * connector, and NOTHING marking the step in progress. It sat on the same
 * page as the custody trail, which draws `CustodyTimeline`'s navy and
 * seal-orange markers, so a customer watching their bags met two different
 * visual languages on one screen and the one describing what was happening
 * right now was the quieter of the two.
 *
 * `ProgressTrack` in @koolee/ui is that strip, drawing the shared `StageDot`.
 * The old comment here said `MilestoneTrack` "has no notion of you-are-here,
 * which is the only thing this needs to say" — correct, and the answer was a
 * component that does, not a private copy.
 */
export function PickupProgress({ stepIndex }: { stepIndex: number }) {
  return <ProgressTrack steps={PICKUP_STEPS} currentIndex={stepIndex} />;
}
