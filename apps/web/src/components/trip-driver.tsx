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
import { driverPins } from "@/lib/driver-pins";
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
  /** Where they are right now. Null until the first ping, or once it is stale. */
  position: { lat: number; lng: number } | null;
  /**
   * Whether the driver has started this leg (`startPickupTravel`).
   *
   * It is the difference between two silences that look identical on screen
   * and are not: "nobody is coming yet, and that is fine" versus "somebody is
   * coming and we have lost sight of them". The card says which.
   */
  travelStarted: boolean;
}

/* ------------------------------------------------------------------ */
/* 1. Choosing                                                          */
/* ------------------------------------------------------------------ */

export function DriverChoice({
  bookingId,
  candidates,
  pickup,
  pickupAddressLine = null,
  bestShiftId,
}: {
  bookingId: string;
  candidates: DriverCandidateView[];
  /** The door, for the map. Null when the address has no coordinates. */
  pickup: { lat: number; lng: number } | null;
  /** The doorstep in words, for the pickup pin's card. */
  pickupAddressLine?: string | null;
  /**
   * Who "pick the best" would choose, decided SERVER-SIDE by `bestCandidate`.
   *
   * Passed down rather than recomputed here so the button and the server
   * cannot disagree about who is best — and so the rule stays in core, where
   * it is tested, rather than in a component. Null when the shortlist has
   * nobody with an ETA to rank.
   */
  bestShiftId: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SelectDriverState, FormData>(
    selectDriverAction,
    {},
  );
  /**
   * Which pin is open. PURELY A HIGHLIGHT — it commits nothing.
   *
   * Choosing a driver is irreversible (the pickup task is claimed and the
   * shortlist closes), so a tap on a map pin must never be the tap that does
   * it. It opens a card; the card's own button is what chooses.
   *
   * Held HERE rather than inside `LiveMap` because it is the same fact as
   * which row is highlighted in the list below. Two components each keeping
   * their own copy is how they end up disagreeing.
   */
  const [focusRequest, setFocused] = React.useState<string | null>(null);
  /**
   * MAP OR LIST, one at a time — TD's call, and the pattern every delivery
   * product uses.
   *
   * The first version stacked them: map on top, four cards under it. On a
   * phone that gave the map about a third of the screen and put the cards
   * below the fold, so neither view was any good — the map too small to judge
   * distance on, the list needing a scroll to reach. Two full-size views and a
   * toggle beats two half ones.
   *
   * MAP IS THE DEFAULT because it answers the question people actually have —
   * "who is near me" — and the list answers the follow-up. Once a driver is
   * chosen the toggle is gone entirely: `DriverTracking` is map-only, because
   * there is nothing left to compare.
   */
  const [view, setView] = React.useState<"map" | "list">("map");

  // A lost race is not a dead end. `revalidatePath` already ran server-side;
  // this pulls the refreshed shortlist so the customer's next click is a
  // different driver rather than a retry of the one who just filled up.
  useEffect(() => {
    if (state.stale) router.refresh();
  }, [state.stale, router]);

  /*
   * A DRIVER WHO DROPS OUT TAKES THE OPEN CARD WITH THEM.
   *
   * The shortlist refreshes underneath this component every time the booking
   * signals or the poll fires. A driver who clocked off, or whose van filled
   * up, simply stops appearing — and a card anchored to them would go on
   * offering a Select button for somebody who is no longer selectable.
   *
   * DERIVED, not synced. The obvious version is an effect that clears the
   * state when the id disappears, and it is wrong twice: it renders one frame
   * with a card for a driver who is gone, and it sets state inside an effect,
   * which cascades a second render before paint. What is open is a FUNCTION of
   * the shortlist, so it is computed rather than remembered.
   */
  const focused =
    focusRequest && candidates.some((c) => c.shiftId === focusRequest)
      ? focusRequest
      : null;

  if (candidates.length === 0) return <NoDriverYet />;

  const allOutOfZone = candidates.every((c) => c.outOfZone);
  // A driver with no fix keeps their card and gets no pin — see `driverPins`.
  const pins = driverPins(candidates, focused);
  /*
   * Whether a map is possible at all. A map of vans with no reference point is
   * worse than no map, and pins with nowhere to be drawn are not a map either.
   *
   * Read ONCE and used for both the toggle and the view, so the two cannot
   * disagree — a toggle offering a view that renders nothing is the failure
   * this variable exists to prevent.
   */
  const showMap = pickup !== null && pins.length > 0;
  const showing = showMap ? view : "list";

  /*
   * A pin tap opens that driver's card and nothing else.
   *
   * It used to also scroll the matching list row into view, which made sense
   * when the list sat under the map. With one view at a time the list is not
   * mounted while a pin is tappable, so that scroll could never run — and the
   * anchored card now carries the same facts the row did. The highlight
   * SURVIVES the toggle, so switching to List after tapping a pin lands on a
   * highlighted row.
   */
  const onPinClick = (shiftId: string) => setFocused(shiftId);

  const byShift = new Map(candidates.map((c) => [c.shiftId, c] as const));

  return (
    // `overflow-hidden` so the flush map below takes the CARD's corner radius
    // rather than spilling past it — see `frame` on `LiveMap`.
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="font-display text-base">Choose your driver</CardTitle>
        <CardDescription>
          {allOutOfZone
            ? "Everyone close by is full right now, so these drivers are coming from a little further out — they will take a bit longer to reach you."
            : "Your bags are sealed and ready. Pick whoever suits you; they will collect your bags and deliver them to your airline's bag drop."}
        </CardDescription>
        {/*
          THE TOGGLE ONLY EXISTS WHEN THERE IS A MAP TO SWITCH TO.
          
          No coordinates on the address, or nobody has reported a position, and
          there is no map — so the list is not one of two views, it is the only
          view, and a control offering a second one would be a lie. This is the
          case the toggle is easiest to get wrong in: `showMap` is exactly the
          condition the map is rendered under, read once.
        */}
        {/*
          THE HINT LIVES HERE, not under the map — TD's note. Below the map it
          forced a gap between the map and the card's own edge, which is
          exactly the padding this section had just been stripped of. Under the
          description it reads as part of the instructions, which is what it
          is, and the map below can sit flush with nothing after it.
        */}
        {showMap && showing === "map" && (
          <CardDescription>
            Tap a van to see who it is and choose them.
            {pins.length < candidates.length
              ? " Some drivers have not reported a position yet — they are all in the list."
              : " Nothing is booked until you choose."}
          </CardDescription>
        )}
        {showMap && (
          <ViewToggle view={view} onChange={setView} count={candidates.length} />
        )}
      </CardHeader>

      {/*
        NO INNER PADDING ON THIS SECTION, so the map bleeds to the card's own
        edge — TD's note. The page container keeps its padding; the map simply
        stops having a second one inside it, which on a phone was costing the
        map about a fifth of its width for a margin nobody wanted.
      */}
      <CardContent className="flex flex-col gap-4 px-0 pb-0">
        {state.error ? (
          <div className="px-6">
            <FormMessage variant="error">{state.error}</FormMessage>
          </div>
        ) : null}

        {/*
          PICK THE BEST sits ABOVE the map, not inside it: it is an
          alternative to the whole business of choosing, so it should be
          readable before the map invites somebody to start comparing.

          Only offered when there is something to compare. With one driver it
          would be a second button doing exactly what the first one does.
        */}
        {bestShiftId && candidates.length > 1 && (
          <div className="px-6">
            <PickTheBest
              bookingId={bookingId}
              shiftId={bestShiftId}
              driver={byShift.get(bestShiftId) ?? null}
            />
          </div>
        )}

        {showing === "map" ? (
          <LiveMap
            pickup={pickup!}
            drivers={pins}
            onDriverClick={onPinClick}
            popupDriverId={focused}
            onPopupClose={() => setFocused(null)}
            renderPopup={(shiftId) => {
              const driver = byShift.get(shiftId);
              if (!driver) return null;
              return (
                <DriverPopup
                  bookingId={bookingId}
                  driver={driver}
                  formAction={formAction}
                  pending={pending}
                />
              );
            }}
            allowFullscreen
            frame={false}
            recenterLabel="Back to my pickup"
            pickupAddressLine={pickupAddressLine}
            // Taller than it was when a list sat under it: this IS the view
            // now, and a map you have to squint at is not one.
            className="h-80 sm:h-[26rem]"
            label={`Map showing your pickup address and ${pins.length} available ${
              pins.length === 1 ? "driver" : "drivers"
            }`}
          />
        ) : (
          /*
            THE LIST IS A FULL VIEW, not a fallback.

            A name, a van's remaining capacity and an ETA side by side is a
            comparison a map cannot make, and this is also the only view that
            works with no coordinates, no WebGL and no sight. Every driver
            appears here, including the ones with no position to pin.
          */
          <ul className="grid gap-3 px-6 pb-6 sm:grid-cols-2">
            {candidates.map((candidate) => (
              <li key={candidate.shiftId}>
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
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Map or list, one at a time.
 *
 * A `role="tablist"` of real buttons rather than a styled checkbox, matching
 * the agent app's schedule/history control — same shape, same affordance, so
 * the two consoles do not each invent their own segmented control.
 *
 * BOTH VIEWS ARE ALWAYS REACHABLE, which is what keeps this accessible: the
 * list is a tab, not a fallback hidden behind a hover or a breakpoint, and it
 * carries every driver including the ones the map cannot draw.
 */
function ViewToggle({
  view,
  onChange,
  count,
}: {
  view: "map" | "list";
  onChange: (next: "map" | "list") => void;
  /**
   * How many drivers there are, shown on the List tab.
   *
   * ON THE LIST TAB ONLY, and that is the point rather than an omission: the
   * list holds EVERY candidate, while the map can only draw the ones who have
   * reported a position. Two different numbers on two tabs would read as a
   * discrepancy rather than as a fact about GPS, so the tab that can promise
   * the number is the one that carries it — and the map view says the rest in
   * a sentence when the two counts differ.
   */
  count: number;
}) {
  const base =
    "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div
      className="mt-3 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:max-w-56"
      role="tablist"
      aria-label="Map or list"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "map"}
        onClick={() => onChange("map")}
        className={
          view === "map"
            ? `${base} bg-card text-navy-800 shadow-lift`
            : `${base} text-muted-foreground`
        }
      >
        Map
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "list"}
        onClick={() => onChange("list")}
        className={
          view === "list"
            ? `${base} bg-card text-navy-800 shadow-lift`
            : `${base} text-muted-foreground`
        }
      >
        List · {count}
      </button>
    </div>
  );
}

/**
 * The shortcut: one tap, the nearest eligible driver.
 *
 * It runs the SAME `selectDriverAction` as every card below, with the shift id
 * core picked. That is deliberate and load-bearing — there is exactly one way
 * to be assigned a driver, so the transactional recheck, the advisory lock and
 * the lost-race behaviour are identical whether somebody tapped this or read
 * four cards first. A second selection path would be a second set of races.
 *
 * The COPY makes it a shortcut rather than a different offer: it names who it
 * would pick and why, so pressing it is a choice rather than a surrender. A
 * button that said only "pick for me" would be asking for trust it has not
 * earned; naming the driver and the reason lets somebody disagree.
 */
function PickTheBest({
  bookingId,
  shiftId,
  driver,
}: {
  bookingId: string;
  shiftId: string;
  driver: DriverCandidateView | null;
}) {
  const [state, formAction, pending] = useActionState<SelectDriverState, FormData>(
    selectDriverAction,
    {},
  );
  const router = useRouter();
  useEffect(() => {
    if (state.stale) router.refresh();
  }, [state.stale, router]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tag-200 bg-tag-50/50 p-3">
        <p className="text-sm">
          <span className="font-medium">In a hurry?</span> We&rsquo;ll pick{" "}
          {driver?.givenName ?? "whoever"}
          {driver?.hasEta ? ` — closest to you, ${driver.etaLabel}` : " — closest to you"}
          .
        </p>
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Pick the best for me
        </Button>
      </div>
    </form>
  );
}

/**
 * The card anchored to a pin.
 *
 * Deliberately the SAME facts as the list row — name, truck, room, ETA — and
 * the same Select. A popover showing different information from the card three
 * inches below it would make somebody wonder which one to believe.
 *
 * It is its own `<form>` rather than a button reaching into the list's: the
 * popup is portalled into a node MapLibre owns and moves, which is nowhere
 * near the list in the DOM tree, so a `form` attribute pointing at it would be
 * the only thing holding them together.
 */
function DriverPopup({
  bookingId,
  driver,
  formAction,
  pending,
}: {
  bookingId: string;
  driver: DriverCandidateView;
  formAction: (payload: FormData) => void;
  pending: boolean;
}) {
  return (
    <form action={formAction} className="flex w-60 flex-col gap-3 p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="shiftId" value={driver.shiftId} />

      {/* `pr-5` on the top row only: the close button sits over that corner,
          and padding the whole card would leave everything below it short. */}
      <div className="flex items-center gap-2 pr-5">
        <Avatar size="sm" name={driver.givenName} src={driver.avatarUrl} alt="" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {driver.givenName ?? "Koolee driver"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{driver.truckName}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={driver.hasEta ? "default" : "secondary"}>{driver.etaLabel}</Badge>
        {driver.outOfZone ? <Badge variant="secondary">Further out</Badge> : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Room for {driver.availableCapacity} more{" "}
        {driver.availableCapacity === 1 ? "bag" : "bags"} after yours.
      </p>

      <Button type="submit" size="sm" className="w-full" loading={pending}>
        Choose {driver.givenName ?? "this driver"}
      </Button>
    </form>
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
          Your bags are sealed and ready to go. We&rsquo;re matching you with a driver now
          — you&rsquo;ll get a confirmation as soon as they&rsquo;re on it.
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
  pickupAddressLine = null,
  cancelled = false,
}: {
  driver: SelectedDriverView;
  live: boolean;
  pickup: { lat: number; lng: number } | null;
  /** The doorstep in words, for the pickup pin's card. */
  pickupAddressLine?: string | null;
  /**
   * The booking was cancelled after a driver was chosen.
   *
   * The card STAYS. A customer who picked a driver, watched the ETA and then
   * cancelled should still see that the leg existed — dropping the card makes
   * the trip page read as though no driver was ever assigned, which is not
   * what happened and not what a dispute would be argued against.
   */
  cancelled?: boolean;
}) {
  /*
   * THE MAP IS ONLY FOR A JOURNEY IN PROGRESS. Once the bags are at the bag
   * drop there is no van to watch, and a map of where somebody was is not a
   * receipt — the custody timeline is. Also gated on having both ends: a pin
   * with no reference point tells nobody anything.
   *
   * A cancelled booking is never live, whatever its position field still
   * holds: a pin walking towards a door nobody is going to is the single most
   * misleading thing this page could draw.
   */
  const showMap = live && !cancelled && pickup !== null && driver.position !== null;

  return (
    <Card className={cancelled ? "opacity-90" : undefined}>
      <CardHeader>
        <CardTitle className="font-display text-base">Your driver</CardTitle>
        <CardDescription>
          {cancelled
            ? "This trip was cancelled. Nobody is on the way."
            : live
              ? "Updating as your driver moves."
              : "Your bags are with your airline now."}
        </CardDescription>
      </CardHeader>
      {/*
        NO INNER PADDING, so the map bleeds to the card edge — TD's note, and
        the same treatment the shortlist above gets. Everything that is NOT
        the map puts the padding back on itself, which is a few `px-6`s in
        exchange for a map that is not wearing a frame inside a frame.
      */}
      <CardContent className="flex flex-col gap-5 px-0 pb-0">
        <div className="flex flex-wrap items-center gap-4 px-6">
          <Avatar size="lg" name={driver.givenName} src={driver.avatarUrl} alt="" />
          <div className="min-w-0">
            <p className="font-medium">{driver.givenName ?? "Your Koolee driver"}</p>
            <p className="text-sm text-muted-foreground">{driver.truckName}</p>
          </div>
          {live && !cancelled ? (
            <div className="ml-auto text-right">
              <p className="font-display text-lg">{driver.etaLabel}</p>
              <p className="text-sm text-muted-foreground">
                {driver.distanceLabel ??
                  (driver.travelStarted ? "Position updating" : "Not on the way yet")}
              </p>
            </div>
          ) : null}
        </div>

        {/*
          NO MAP IS TWO DIFFERENT FACTS, and an absent card says neither.
          Before the driver starts the leg there is genuinely nothing to track,
          and a customer staring at a card with no map cannot tell that from a
          map that failed. After they start, a gap means we have lost sight of
          them, which is worth saying out loud rather than leaving as a blank.
        */}
        {live && !cancelled && !showMap && (
          <p className="mx-6 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {driver.travelStarted
              ? "We've lost the live position for a moment — it comes back on its own, and your driver is still on the way."
              : `Live tracking starts when ${driver.givenName ?? "your driver"} sets off for you.`}
          </p>
        )}

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
            frame={false}
            pickupAddressLine={pickupAddressLine}
            className="h-64 sm:h-72"
            label={`Map showing ${driver.givenName ?? "your driver"} on the way to your pickup address`}
          />
        )}

        <div className="px-6">
          <PickupProgress stepIndex={driver.stepIndex} cancelled={cancelled} />
        </div>

        {live && !cancelled && driver.lastSeenLabel ? (
          <p className="px-6 pb-6 text-xs text-muted-foreground">
            Location last updated {driver.lastSeenLabel}.
          </p>
        ) : (
          /* The card still needs a floor when the last line is absent. */
          <div className="pb-6" />
        )}
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
export function PickupProgress({
  stepIndex,
  cancelled = false,
}: {
  stepIndex: number;
  /** The booking was cancelled: every stage draws struck through. */
  cancelled?: boolean;
}) {
  return (
    <ProgressTrack steps={PICKUP_STEPS} currentIndex={stepIndex} cancelled={cancelled} />
  );
}
