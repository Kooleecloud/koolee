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
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressTrack,
  SegmentedControl,
  cn,
} from "@koolee/ui";

import {
  selectDriverAction,
  type SelectDriverState,
} from "@/app/trips/[bookingId]/actions";
import { driverPins } from "@/lib/driver-pins";
import { ghostDrivers } from "@/lib/ghost-drivers";
import { pickupSteps } from "@/lib/pickup-progress";

/**
 * The customer's driver: choosing one, then watching them come.
 *
 * ONE CARD, AND THE MAP IS ALWAYS IN IT. That is the change, and it is worth
 * saying what it replaced. There were three cards here — a shortlist, a
 * text-only "we're assigning your driver", and a tracking card — and the map
 * appeared in two of them under three separate conditions: a non-null pickup,
 * a non-empty pin list, and a fresh fix. Any one of those failing produced a
 * page with no map at all, and the two most common failures happened at the
 * two most anxious moments: while nobody had been assigned yet, and while a
 * chosen driver's phone was in a pocket.
 *
 * TD's report was that the map "is completely gone". It was not one bug; it
 * was three gates, each individually defensible. So the gates are gone and the
 * map is the card:
 *
 *  - no shortlist yet → the door, and ghost pins (see `ghostDrivers`);
 *  - a shortlist → their pins, greyed where a fix has aged;
 *  - a chosen driver → their pin, a bar saying who and how long, and a
 *    five-stage strip under it.
 *
 * The only thing that can still remove the map is a booking with no pickup
 * COORDINATES, which is a hand-typed address Places never resolved. There is
 * genuinely nothing to draw, and the list view carries on alone.
 *
 * CHOOSING IS STILL A LIST DECISION. Pins are a second way to reach the same
 * cards — tap a pin, its card opens anchored to it — because a name, a van's
 * remaining capacity and an ETA do not fit in a pin, and those are what
 * somebody actually chooses on. The List tab is also the only view that works
 * with no coordinates, no WebGL and no sight.
 */

export interface DriverCandidateView {
  shiftId: string;
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  /** Room left on that van after this booking's bags. */
  availableCapacity: number;
  outOfZone: boolean;
  /** Preformatted by `formatEtaMinutes` — "about 25 min" or "Locating…". */
  etaLabel: string;
  /** True when the ETA is a real estimate rather than the fallback phrase. */
  hasEta: boolean;
  /**
   * Last known position. Null means this driver has never reported at all,
   * and only that — an aged fix is still a position and still drawn.
   */
  position: { lat: number; lng: number } | null;
  /** False when `position` is a last-known fix rather than a current one. */
  positionIsFresh: boolean;
  /** "4 min ago", for a stale pin. Null when fresh or never reported. */
  positionAgoLabel: string | null;
}

export interface SelectedDriverView {
  givenName: string | null;
  avatarUrl: string | null;
  truckName: string;
  etaLabel: string;
  /** Miles, e.g. "3.2 miles away". Null when there is no usable position. */
  distanceLabel: string | null;
  /** Airport-local, preformatted. Null when there is no position yet. */
  lastSeenLabel: string | null;
  /** "4 min ago". Null when the fix is fresh or there has never been one. */
  positionAgoLabel: string | null;
  /** Where the bags are, as an index into `pickupSteps`. */
  stepIndex: number;
  /** Last known position, fresh or not. Null only if they never reported. */
  position: { lat: number; lng: number } | null;
  positionIsFresh: boolean;
  /**
   * Whether the driver has started this leg (`startPickupTravel`).
   *
   * It is the difference between two silences that look identical on screen
   * and are not: "nobody is coming yet, and that is fine" versus "somebody is
   * coming and we have lost sight of them".
   */
  travelStarted: boolean;
}

export function TripDriverPanel({
  bookingId,
  pickup,
  pickupAddressLine = null,
  choosing,
  candidates,
  bestShiftId,
  selected,
  live,
  cancelled = false,
}: {
  bookingId: string;
  /** The door. Null when the address has no coordinates — the only no-map case. */
  pickup: { lat: number; lng: number } | null;
  pickupAddressLine?: string | null;
  /** The customer may pick a driver right now. */
  choosing: boolean;
  candidates: DriverCandidateView[];
  bestShiftId: string | null;
  /** The driver they picked, once they have. */
  selected: SelectedDriverView | null;
  /** False once the booking is terminal — nothing left to watch. */
  live: boolean;
  cancelled?: boolean;
}) {
  if (selected) {
    return (
      <TrackingCard
        driver={selected}
        live={live}
        cancelled={cancelled}
        pickup={pickup}
        pickupAddressLine={pickupAddressLine}
      />
    );
  }
  if (!choosing) return null;
  return (
    <ChoosingCard
      bookingId={bookingId}
      candidates={candidates}
      pickup={pickup}
      pickupAddressLine={pickupAddressLine}
      bestShiftId={bestShiftId}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 1. Choosing — including the wait before there is anybody to choose   */
/* ------------------------------------------------------------------ */

function ChoosingCard({
  bookingId,
  candidates,
  pickup,
  pickupAddressLine,
  bestShiftId,
}: {
  bookingId: string;
  candidates: DriverCandidateView[];
  pickup: { lat: number; lng: number } | null;
  pickupAddressLine: string | null;
  bestShiftId: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SelectDriverState, FormData>(
    selectDriverAction,
    {},
  );
  const [focusRequest, setFocused] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"map" | "list">("map");

  const searching = candidates.length === 0;

  /*
   * NO DRIFT TIMER ANY MORE. The ghosts used to be nudged on an interval, and
   * because every pin re-seeded off the same counter they all set off at the
   * same instant in the same direction — which looked less like traffic than
   * standing still did. They hold position and pulse now, so there is no
   * clock here to own. See `ghostDrivers`.
   */

  // A lost race is not a dead end. `revalidatePath` already ran server-side;
  // this pulls the refreshed shortlist so the customer's next click is a
  // different driver rather than a retry of the one who just filled up.
  useEffect(() => {
    if (state.stale) router.refresh();
  }, [state.stale, router]);

  /*
   * A DRIVER WHO DROPS OUT TAKES THE OPEN CARD WITH THEM. Derived, not synced:
   * an effect clearing the state would render one frame with a card for a
   * driver who is gone, and set state inside an effect to do it.
   */
  const focused =
    focusRequest && candidates.some((c) => c.shiftId === focusRequest)
      ? focusRequest
      : null;

  const allOutOfZone = candidates.length > 0 && candidates.every((c) => c.outOfZone);
  const realPins = driverPins(candidates, focused);
  /*
   * GHOSTS OR REAL PINS, NEVER BOTH — and this matters more now they look
   * alike. A masked placeholder beside a named van would invite somebody to
   * tap the one that cannot be tapped.
   */
  const pins = searching && pickup ? ghostDrivers(bookingId, pickup) : realPins;

  /*
   * A map needs a reference point, and that is the ONLY thing it needs now.
   * It used to also require at least one pin, which is what made the map
   * vanish exactly when there was nobody to show — the moment it was most
   * worth drawing something.
   */
  const showMap = pickup !== null;
  const showing = showMap ? view : "list";
  const staleCount = candidates.filter(
    (c) => c.position !== null && !c.positionIsFresh,
  ).length;
  const unpinned = candidates.filter((c) => c.position === null).length;

  const onPinClick = (shiftId: string) => setFocused(shiftId);
  const byShift = new Map(candidates.map((c) => [c.shiftId, c] as const));

  return (
    // `overflow-hidden` so the flush map takes the CARD's corner radius.
    <Card className="overflow-hidden">
      {/*
        ONE ROW: what this is, then what you can do about it.

        The header used to carry three stacked paragraphs of explanation, a
        "Pick the best for me" card and the Map/List toggle, and the card that
        was supposed to be a map had half a screen of chrome above it. TD's
        call: the title and the controls on one line, and the prose behind an
        (i) — a customer who has read it once does not need it again, and one
        who has not can ask.
      */}
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="font-display text-base">
            {searching ? "Finding your driver" : "Choose your driver"}
          </CardTitle>
          <DriverInfo
            searching={searching}
            allOutOfZone={allOutOfZone}
            showingMap={showMap && showing === "map"}
            unpinned={unpinned}
            staleCount={staleCount}
          />
        </div>

        {/* `shrink-0` so the pair wraps as a UNIT under the title rather than
            being compressed until its labels break. */}
        <div className="flex shrink-0 items-center gap-2">
          {/*
            PICK FOR ME sits BEFORE the view switch, so the two controls read
            in the order somebody uses them: decide not to choose, or choose
            how to look. Only offered when there is something to compare —
            with one driver it would be a second button doing exactly what the
            first one does.
          */}
          {bestShiftId && candidates.length > 1 && (
            <PickTheBest
              bookingId={bookingId}
              shiftId={bestShiftId}
              driver={byShift.get(bestShiftId) ?? null}
            />
          )}

          {/* Only exists when there is a list worth switching to. While
              searching there is nothing in it. */}
          {showMap && !searching && (
            <SegmentedControl
              items={[
                { value: "map" as const, label: "Map" },
                { value: "list" as const, label: `List · ${candidates.length}` },
              ]}
              value={view}
              onChange={setView}
              label="Map or list"
              className="w-auto shrink-0"
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-0 pb-0">
        {state.error ? (
          <div className="px-6">
            <FormMessage variant="error">{state.error}</FormMessage>
          </div>
        ) : null}

        {showing === "map" ? (
          <div className="relative">
            <LiveMap
              pickup={pickup!}
              drivers={pins}
              /*
               * Handed the click even while searching, and it costs nothing:
               * a ghost renders a `span` inside a `pointer-events-none` root,
               * so there is no element for this to fire from. The inertness is
               * structural rather than a condition that could be forgotten.
               */
              onDriverClick={onPinClick}
              popupDriverId={searching ? null : focused}
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
              /*
                NOTHING TO REACH WHILE WE ARE STILL LOOKING. The pins are
                placeholders, the controls would pan a view about to be
                re-framed around real drivers, and a tap that does nothing
                teaches somebody the map is broken. The scrim still lets the
                page scroll — see `blockInteraction`.
              */
              blockInteraction={searching}
              allowFullscreen
              frame={false}
              recenterLabel="Back to my pickup"
              pickupAddressLine={pickupAddressLine}
              // The map IS the view now, so it gets the height the toggle used
              // to share with a list below it.
              className="h-[22rem] sm:h-[28rem]"
              label={
                searching
                  ? "Map showing your pickup address while we find a driver"
                  : `Map showing your pickup address and ${realPins.length} available ${
                      realPins.length === 1 ? "driver" : "drivers"
                    }`
              }
            />
            {searching && <SearchingChip />}
          </div>
        ) : (
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
 * Everything the header used to say out loud.
 *
 * WHY IT IS BEHIND A BUTTON. Three paragraphs sat stacked above the map: what
 * sealing means, how to tap a van, what a grey van means, and whether anything
 * was booked yet. All of it true and all of it read once — after which it was
 * half a screen between a customer and the map they came for. A customer who
 * has not read it can ask; one who has should not have to scroll past it every
 * time the page refreshes.
 *
 * IT STILL SAYS THE CONDITIONAL THINGS. The out-of-zone case and the grey-pin
 * case are not decoration — they explain a longer ETA and a stale position —
 * so they are assembled here rather than dropped.
 */
function DriverInfo({
  searching,
  allOutOfZone,
  showingMap,
  unpinned,
  staleCount,
}: {
  searching: boolean;
  allOutOfZone: boolean;
  showingMap: boolean;
  unpinned: number;
  staleCount: number;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="About choosing your driver"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-navy-800 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 text-sm"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p>
          {searching
            ? "Your bags are sealed and ready. We're matching you with a driver nearby — this page updates on its own."
            : allOutOfZone
              ? "Everyone close by is full right now, so these drivers are coming from a little further out — they will take a bit longer to reach you."
              : "Your bags are sealed and ready. Pick whoever suits you; they will collect your bags and deliver them to your airline's bag drop."}
        </p>
        {showingMap && !searching && (
          <p className="mt-2 text-muted-foreground">
            Tap a van to see who it is and choose them.
            {unpinned > 0
              ? " Some drivers have not reported a position yet — they are all in the list."
              : staleCount > 0
                ? " A greyed van is a last known position, not a live one."
                : " Nothing is booked until you choose."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The label over the searching map.
 *
 * IT SAYS WHAT IS HAPPENING, NOT WHAT IS THERE. "Finding drivers near you" is
 * about our search; a count of the dots on the map would be a claim about
 * supply, which is the line this state must not cross. The dots carry no
 * number and this carries no number, deliberately.
 */
function SearchingChip() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-navy-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-sky-300 motion-reduce:animate-none"
        />
        Finding drivers near you…
      </span>
    </div>
  );
}

/**
 * The shortcut: one tap, the nearest eligible driver.
 *
 * Runs the SAME `selectDriverAction` as every card, with the shift id core
 * picked — one way to be assigned a driver, so the transactional recheck, the
 * advisory lock and the lost-race behaviour are identical either way.
 *
 * The COPY makes it a shortcut rather than a different offer: it names who it
 * would pick and why, so pressing it is a choice rather than a surrender.
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

  /*
   * A BUTTON IN THE HEADER, not a card in the body.
   *
   * It used to be a tinted panel carrying a sentence — "In a hurry? We'll pick
   * Marcus — closest to you, about 25 min" — which named who it would choose
   * and why, so pressing it was a choice rather than a surrender. That
   * reasoning is intact and the sentence moved into the button's TITLE rather
   * than being lost: the control is two words on the same line as the view
   * switch, and hovering or focusing it still says who and why before it is
   * pressed. On a phone, where there is no hover, the shortlist below is the
   * answer to "who would that be?".
   */
  const promise = driver?.givenName
    ? `We'll pick ${driver.givenName}${driver.hasEta ? ` — closest to you, ${driver.etaLabel}` : " — closest to you"}`
    : "We'll pick whoever is closest to you";

  return (
    <form action={formAction}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      {/* A refusal has to appear even though the control is now one line: the
          toast-less alternative is a button that silently does nothing. */}
      {state.error ? (
        <p className="mr-2 inline text-xs text-destructive">{state.error}</p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        title={promise}
      >
        Pick for me
      </Button>
    </form>
  );
}

/**
 * The card anchored to a pin. Deliberately the SAME facts as the list row —
 * a popover showing different information from the card three inches below it
 * would make somebody wonder which one to believe.
 *
 * Its own `<form>` rather than a button reaching into the list's: the popup is
 * portalled into a node MapLibre owns and moves, nowhere near the list in the
 * DOM tree.
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

      {/* Said in the popup as well as on the pin: somebody who tapped a grey
          van is asking exactly this question. */}
      {!driver.positionIsFresh && driver.positionAgoLabel ? (
        <p className="text-xs text-muted-foreground">
          Last seen {driver.positionAgoLabel}.
        </p>
      ) : null}

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

/* ------------------------------------------------------------------ */
/* 2. Watching                                                          */
/* ------------------------------------------------------------------ */

/**
 * REFRESH IS NOT THIS COMPONENT'S JOB. `TripLive` sits at page level and
 * refreshes on a `booking_signals` change, so everything on the page updates
 * rather than one card. Do not re-add a timer here.
 */
function TrackingCard({
  driver,
  live,
  pickup,
  pickupAddressLine,
  cancelled,
}: {
  driver: SelectedDriverView;
  live: boolean;
  pickup: { lat: number; lng: number } | null;
  pickupAddressLine: string | null;
  cancelled: boolean;
}) {
  /*
   * A STALE PIN IS DRAWN, NOT DROPPED — the change TD asked for.
   *
   * This used to require `positionIsFresh`, so a driver whose phone went into
   * a pocket took the whole map with them: the card collapsed to a sentence at
   * the exact moment somebody was watching hardest. The last known position,
   * grey and unpulsed with its age beside it, answers more than a blank does
   * and cannot be mistaken for live.
   *
   * A CANCELLED BOOKING IS STILL NEVER LIVE, whatever the position field
   * holds. A pin walking towards a door nobody is going to is the single most
   * misleading thing this page could draw.
   */
  const showMap = live && !cancelled && pickup !== null && driver.position !== null;
  const steps = pickupSteps(driver.givenName);

  return (
    <Card className={cn(cancelled && "opacity-90", "overflow-hidden")}>
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

      <CardContent className="flex flex-col gap-4 px-0 pb-0">
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
                variant: driver.positionIsFresh ? "live" : "stale",
              },
            ]}
            frame={false}
            pickupAddressLine={pickupAddressLine}
            className="h-[20rem] sm:h-[26rem]"
            label={`Map showing ${driver.givenName ?? "your driver"} on the way to your pickup address`}
          />
        )}

        {/*
          NO MAP IS TWO DIFFERENT FACTS, and an absent card says neither. With
          a stale pin now drawn rather than hidden, this is down to the two
          cases where there is genuinely no coordinate to place: a driver who
          has never reported, and a booking whose address never resolved.
        */}
        {live && !cancelled && !showMap && (
          <p className="mx-6 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {driver.travelStarted
              ? "We've lost the live position for a moment — it comes back on its own, and your driver is still on the way."
              : `Live tracking starts when ${driver.givenName ?? "your driver"} sets off for you.`}
          </p>
        )}

        {/* WHO, AND HOW LONG — the two things somebody wants under a map. */}
        <div className="flex flex-wrap items-center gap-3 px-6">
          <Avatar size="lg" name={driver.givenName} src={driver.avatarUrl} alt="" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {cancelled
                ? (driver.givenName ?? "Your Koolee driver")
                : `${driver.givenName ?? "Your Koolee driver"} ${headline(driver)}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {driver.truckName}
              {live && !cancelled && driver.distanceLabel
                ? ` · ${driver.distanceLabel}`
                : ""}
            </p>
          </div>
          {live && !cancelled ? (
            <p className="font-display text-lg whitespace-nowrap">{driver.etaLabel}</p>
          ) : null}
        </div>

        {/*
          THE TRACK IS A CAPTION NOW, not the card. `compact` is what keeps
          five stages to about one line — the full-size strip stacked into five
          rows on a phone and pushed the map off the screen, which is the
          opposite of the point.
        */}
        <div className="px-6">
          <ProgressTrack
            steps={steps}
            currentIndex={driver.stepIndex}
            cancelled={cancelled}
            compact
          />
        </div>

        {live && !cancelled && !driver.positionIsFresh && driver.positionAgoLabel ? (
          <p className="px-6 pb-6 text-xs text-muted-foreground">
            Last seen {driver.positionAgoLabel}. The grey van is where we saw them last.
          </p>
        ) : live && !cancelled && driver.lastSeenLabel ? (
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
 * What the driver is doing, in three words, keyed off the stage.
 *
 * Read from `stepIndex` rather than from `travelStarted` alone, so the line
 * and the strip beneath it can never describe different moments — which is
 * exactly the kind of disagreement two sources for one fact produce.
 */
function headline(driver: SelectedDriverView): string {
  if (driver.stepIndex >= 4) return "delivered your bags";
  if (driver.stepIndex >= 3) return "is on the way to the bag drop";
  if (driver.stepIndex >= 2) return "has your bags";
  if (driver.travelStarted) return "is on the way to you";
  return "is assigned to you";
}
