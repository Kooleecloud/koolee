import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Avatar,
  BackLink,
  BookingStatusBadge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  FormMessage,
  ImageLightbox,
  PageHeader,
} from "@koolee/ui";
import {
  DRIVER_SELECTABLE_STATUSES,
  formatEtaMinutes,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  bestCandidate,
  cancellationFromTimeline,
  customerCancelEligibility,
  getBookingActionability,
  getBookingAgreementState,
  getBookingDetailForSession,
  getPassportVerification,
  getSelectedDriver,
  formatMiles,
  haversineKm,
  listCandidateDrivers,
  pickupCoordinates,
  reportEmptyDriverPool,
  type AssignedAgent,
} from "@koolee/core";

import { CustodyTimeline, type TimelineActor } from "@/components/custody-timeline";
import { TripCancel, TripCancelledNotice } from "@/components/trip-cancel";
import { TripLive } from "@/components/trip-live";
import { TripPushPrompt } from "@/components/trip-push-prompt";
import { CutoffCountdown } from "@/components/cutoff-countdown";
import { withinCutoffHorizon } from "@/lib/cutoff-horizon";
import { pushNotificationsEnabled } from "@/env";
import { withinPushPromptWindow } from "@/lib/push-prompt-window";
import {
  TripActionNeeded,
  type TripAgreementView,
  type TripPassportView,
} from "@/components/trip-action-needed";
import {
  TripDriverPanel,
  type DriverCandidateView,
  type SelectedDriverView,
} from "@/components/trip-driver";
import { signAvatarUrlsForBooking, signShortlistAvatarUrl } from "@/lib/avatars";
import { flightRouteLabel, flightRouteText } from "@/lib/flight-label";
import { pickupStepIndexFor } from "@/lib/pickup-progress";
import { positionAgoLabel } from "@/lib/position-age";
import { signBagPhotoUrls } from "@/lib/bag-photos";
import { tryGetCore } from "@/lib/core";
import { tagBooking } from "@/lib/sentry";
import { signPassportPhotoUrl } from "@/lib/passport-photos";
import { getCustomerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One fetch per request: `cache` dedupes between `generateMetadata` and the
 * page body, so the title costs no extra query. Auth stays inside —
 * `getBookingDetailForSession` 404s on other people's bookings, and the
 * metadata path inherits that (no identifying title for a trip the viewer
 * can't see).
 */
const loadTripDetail = cache(async (bookingId: string) => {
  const core = tryGetCore();
  if (!core) return null;
  const session = await getCustomerSession();
  if (!session) return null;
  return getBookingDetailForSession(core.db, session, bookingId).catch(() => null);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const detail = await loadTripDetail(bookingId);
  if (!detail) return { title: "Trip" };
  return {
    title: `${flightRouteText(detail.booking)} · ${detail.booking.flightNumber}`,
  };
}

/**
 * Task status in customer language. The internal vocabulary ("assigned",
 * "in_progress") describes our queue, not the customer's morning.
 */
const AGENT_STATUS_COPY: Record<AssignedAgent["taskStatus"], string> = {
  pending: "· not yet confirmed",
  assigned: "· confirmed for your window",
  in_progress: "· with you now",
  done: "· visit complete",
  failed: "· we're sorting this out",
};

export default async function TripPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const core = tryGetCore();

  if (!core) {
    return <DatabaseNotConfigured />;
  }

  // Authorization lives in core: `getBookingForSession` enforces
  // `canActOnBooking` and 404s (not 403s) on other people's bookings.
  const session = await getCustomerSession();
  if (!session) notFound();

  const result = await loadTripDetail(bookingId);
  if (!result) notFound();

  const {
    booking,
    timeline,
    bags,
    payments,
    pickupAddress,
    assignedAgent,
    tz,
    bagDropCutoffAt: cutoffAt,
  } = result;

  // From here on, anything this render throws carries the booking's ref. One
  // KOO-XXXXX typed into Sentry pulls the customer's errors, the agent app's
  // and the console's together — which is the whole reason support has a ref.
  tagBooking({ ref: booking.ref, id: booking.id, userId: session.userId });

  /*
   * The faces on this booking, resolved by RELATIONSHIP rather than by path.
   *
   * The customer is not staff, so 0027's read policy refuses these under their
   * own session — correctly. The service-role mint is behind
   * `avatarPathsForViewer`, which takes user IDS and a booking and returns
   * only what the relationship permits: for a customer, the agent assigned to
   * the visit and the driver assigned to the pickup, and nobody else. A
   * subject they may not see is simply absent, which renders as initials.
   *
   * Resolved AFTER the ownership check above, and in one call for both people.
   */
  const selectedDriver = await getSelectedDriver(core.db, booking.id);
  const relatedAvatars = await signAvatarUrlsForBooking({
    db: core.db,
    viewer: session,
    bookingId: booking.id,
    subjectUserIds: [assignedAgent?.userId, selectedDriver?.staffUserId],
  });
  /*
   * THE FACES ON THE TRAIL, from the two people already loaded for this page.
   *
   * NO EXTRA QUERY, and that is the whole reason it is built here rather than
   * inside the timeline component: `assignedAgent` and `selectedDriver` are
   * already resolved for the pickup card and the driver panel, and their
   * avatars are already signed by the call above. What was missing was the
   * link from a `custody_events.actor_user_id` back to them.
   *
   * SCOPED TO THE TWO FIELD ROLES. An admin who reassigns a pickup is an
   * actor on this trail and is deliberately not named to the customer —
   * `NAMED_EVENTS` in the timeline is the other half of that rule.
   */
  const timelineActors = new Map<string, TimelineActor>();
  if (assignedAgent?.userId && assignedAgent.givenName) {
    timelineActors.set(assignedAgent.userId, {
      name: assignedAgent.givenName,
      avatarUrl: relatedAvatars.get(assignedAgent.userId) ?? null,
    });
  }
  if (selectedDriver?.staffUserId && selectedDriver.givenName) {
    timelineActors.set(selectedDriver.staffUserId, {
      name: selectedDriver.givenName,
      avatarUrl: relatedAvatars.get(selectedDriver.staffUserId) ?? null,
    });
  }

  const agentAvatarUrl = assignedAgent
    ? (relatedAvatars.get(assignedAgent.userId) ?? null)
    : null;

  const isActive = !["completed", "cancelled"].includes(booking.status);
  /*
   * The one source of truth for whether this booking can still be acted on.
   *
   * Status alone was answering that question here, which is how a `paid`
   * booking whose flight left an hour ago kept offering an agreement to
   * accept and a driver to choose. The core services refuse those now
   * (services/actionability.ts); this makes the page HONEST about it rather
   * than letting the customer find out by being turned away.
   */
  const actionability = await getBookingActionability(core.db, booking, new Date());
  // Only before the visit: once the agent has taken custody there is nothing
  // to accept and nothing to pre-upload. Mirrors AGREEMENT_ACCEPTABLE_STATUSES.
  const preVisit =
    (booking.status === "paid" || booking.status === "agent_assigned") &&
    (actionability.can.acceptAgreement || actionability.can.uploadPassport);

  const [agreementState, passportRow] = await Promise.all([
    getBookingAgreementState(core.db, booking.id, new Date()),
    getPassportVerification(core.db, booking.id),
  ]);

  const agreementVersion =
    agreementState.acceptedVersion ?? agreementState.currentVersion;

  // Every time in the booking's zone, never the viewer's (docs/TIME.md) — an
  // agreement's effective date is exactly the kind of value that reads wrong
  // when it silently follows the device.
  const agreementView: TripAgreementView = {
    // The version this booking is BOUND by once accepted, and only otherwise
    // what a new acceptance would pin to.
    version: agreementVersion?.version ?? null,
    title: agreementVersion?.title ?? "Booking agreement",
    bodyMd: agreementVersion?.bodyMd ?? "",
    accepted: agreementState.accepted,
  };

  // Signed here, after the booking has already passed the ownership check in
  // `getBookingDetailForSession` — the bucket is private and the row holds a
  // path, never a URL.
  const passportView: TripPassportView = {
    status: passportRow?.status ?? "pending",
    photoUrl: passportRow?.photoStoragePath
      ? await signPassportPhotoUrl(passportRow.photoStoragePath)
      : null,
  };

  /* --- the driver ---------------------------------------------------
   *
   * Everything below runs only once the bags are sealed. Before that there is
   * no driver to choose and nothing to track, and asking for a shortlist would
   * be a query per render for a card that does not exist yet.
   */
  const canChooseDriver =
    (DRIVER_SELECTABLE_STATUSES as readonly string[]).includes(booking.status) &&
    selectedDriver === null &&
    actionability.can.selectDriver;

  const candidates = canChooseDriver
    ? await listCandidateDrivers(core, { bookingId: booking.id }).catch(() => [])
    : [];

  // A sealed booking with nobody to offer pages ops. Raising it from a render
  // is safe because the event id is bucketed by the hour (see
  // `emitDriverPoolEmpty`), so a customer refreshing an anxious page does not
  // page anybody twice. It never throws.
  if (canChooseDriver && candidates.length === 0) {
    await reportEmptyDriverPool(core, { bookingId: booking.id });
  }

  /*
   * Who "pick the best" would choose, decided HERE rather than in the browser.
   *
   * `bestCandidate` is the rule — nearest by ETA, tie-broken on bag load — and
   * it lives in core where it is tested against the same `DriverCandidate`
   * rows the shortlist is built from. Recomputing it client-side from the
   * VIEW models would mean ranking on a preformatted string like "about 25
   * min", which is a different comparison wearing the same label.
   */
  const best = bestCandidate(candidates);

  const candidateViews: DriverCandidateView[] = await Promise.all(
    candidates.map(async (candidate) => ({
      shiftId: candidate.shiftId,
      givenName: candidate.givenName,
      // The shortlist is its own issuance path — nobody is assigned yet, so
      // there is no relationship to resolve. `listCandidateDrivers` above IS
      // the authorization; see `signShortlistAvatarUrl`.
      avatarUrl: await signShortlistAvatarUrl(candidate.avatarStoragePath),
      truckName: candidate.truckName,
      availableCapacity: candidate.availableCapacity - booking.bagCount,
      outOfZone: candidate.outOfZone,
      etaLabel: formatEtaMinutes(candidate.eta),
      hasEta: candidate.eta !== null,
      /*
       * LAST KNOWN, fresh or not. Null now means only "has never reported",
       * so the map can tell a driver who is quiet from one who was never
       * there — and draw the quiet one grey instead of not at all.
       */
      position: candidate.position,
      positionIsFresh: candidate.positionIsFresh,
      positionAgoLabel: candidate.positionIsFresh
        ? null
        : positionAgoLabel(candidate.positionRecordedAt, new Date()),
    })),
  );

  // Awaited before the view is assembled: `estimate` became async in Tier 5 so
  // a routing provider can sit behind the seam. It is not load-bearing — the
  // adapter falls back to arithmetic on any failure and `formatEtaMinutes(null)`
  // is a complete answer — so nothing below branches on it.
  const selectedDriverEta =
    selectedDriver?.position &&
    selectedDriver.positionIsFresh &&
    pickupAddress.lat != null &&
    pickupAddress.lng != null
      ? await core.etaEstimator.estimate({
          from: selectedDriver.position,
          to: { lat: pickupAddress.lat, lng: pickupAddress.lng },
        })
      : null;

  const driverView: SelectedDriverView | null = selectedDriver
    ? {
        givenName: selectedDriver.givenName,
        avatarUrl: relatedAvatars.get(selectedDriver.staffUserId) ?? null,
        truckName: selectedDriver.truckName,
        etaLabel: formatEtaMinutes(selectedDriverEta),
        // Miles, because the customer waiting for this van is in New York.
        // Kilometres stay the internal unit everywhere else — pricing, the
        // centroids, the haversine — and nothing about that changes.
        distanceLabel:
          selectedDriver.position &&
          selectedDriver.positionIsFresh &&
          pickupAddress.lat != null &&
          pickupAddress.lng != null
            ? `${formatMiles(
                haversineKm(selectedDriver.position, {
                  lat: pickupAddress.lat,
                  lng: pickupAddress.lng,
                }),
              )} away`
            : null,
        lastSeenLabel: selectedDriver.positionRecordedAt
          ? formatInstantInAirportTz(selectedDriver.positionRecordedAt, tz)
          : null,
        stepIndex: pickupStepIndexFor(
          booking.status,
          selectedDriver.travelStartedAt !== null,
        ),
        /*
         * THE LAST KNOWN FIX REACHES THE MAP, FRESH OR NOT.
         *
         * It used to be nulled once stale, on the reasoning that drawing a
         * position from yesterday's job puts a van on a street it left hours
         * ago looking exactly as live as a real one. That reasoning is intact
         * — which is why the pin is drawn GREY and unpulsed, with its age in
         * words beside it, rather than presented as current. What changed is
         * the alternative: hiding it emptied the map at the moment somebody
         * was watching it hardest, which is the failure TD reported.
         */
        position: selectedDriver.position,
        positionIsFresh: selectedDriver.positionIsFresh,
        positionAgoLabel: selectedDriver.positionIsFresh
          ? null
          : positionAgoLabel(selectedDriver.positionRecordedAt, new Date()),
        // Distinguishes "nobody is coming yet" from "we have lost sight of
        // somebody who is". Both render as no map; only one is a problem.
        travelStarted: selectedDriver.travelStartedAt !== null,
      }
    : null;

  /*
   * The milestone the page is currently at, for the toast on the client.
   *
   * Computed here rather than derived from `booking.status` alone because the
   * one the customer most needs to hear about is not a status: "choose your
   * driver" is `verified_sealed` AND a shortlist that actually has somebody on
   * it. A toast telling them to choose from an empty list would be worse than
   * silence.
   */
  const liveStage: string | null = !isActive
    ? null
    : booking.status === "exception"
      ? "exception"
      : booking.status === "delivered_to_bagdrop"
        ? "delivered"
        : booking.status === "in_transit"
          ? "in_transit"
          : canChooseDriver && candidateViews.length > 0
            ? "choose_driver"
            : booking.status;

  // The door, for both maps. Null when the address never got coordinates —
  // both components fall back to the list-and-number view they had before.
  const pickupPoint = pickupCoordinates(pickupAddress);
  /*
   * The doorstep in words, for the pickup pin's card. Same fields the Pickup
   * details block renders, on one line — "22 W 34th St, New York" answers the
   * question a coordinate cannot: is this the right door? It matters most to
   * somebody who booked for a friend and has no local sense of the map.
   */
  const pickupAddressLine = pickupAddress
    ? [pickupAddress.line1, pickupAddress.line2, pickupAddress.city]
        .filter((part): part is string => Boolean(part))
        .join(", ")
    : null;

  /*
   * Cancelling: the offer, and the record.
   *
   * The eligibility read is the SAME call the server action makes, so the
   * button and the refusal cannot disagree about the rule. It is one payment
   * lookup and only runs while the booking could still plausibly be cancelled
   * — a completed trip does not pay for a query to be told it cannot be.
   *
   * The record comes off the timeline already in hand rather than a second
   * query; `custody_events` is append-only and carries the actor, which is
   * the whole reason "Cancelled by you" is answerable at all.
   */
  const cancelEligibility = isActive
    ? await customerCancelEligibility(core.db, booking, new Date())
    : { canCancel: false, refusal: null as null };
  const cancellation =
    booking.status === "cancelled" ? cancellationFromTimeline(timeline) : null;

  /*
   * THE MAP'S LIFESPAN: sealed through delivered, and no further.
   *
   * Once the bags are at the bag drop there is no van to watch, no ETA to
   * count down and no stage left to reach — so the whole panel goes, rather
   * than lingering as a map of where somebody used to be. What answers the
   * remaining question ("who handled my bags?") is the handover block further
   * down, which names both people. A cancelled booking KEEPS the card, struck
   * through: the leg existed, and a page that forgets it cannot answer "who
   * was coming?".
   */
  const bagsDelivered =
    booking.status === "delivered_to_bagdrop" || booking.status === "completed";

  /*
   * WHO HANDLED YOUR BAGS, once the watching is over.
   *
   * The driver panel answers "where are my bags" and stops being able to the
   * moment they are delivered. What replaces it is the question that outlives
   * the trip: two people came into contact with somebody's luggage, and the
   * page should be able to name both of them — the agent who sealed at the
   * door, and the driver who handed them to the airline.
   *
   * BOTH ARE ALREADY LOADED. No query is added; this is the same
   * `assignedAgent` and `selectedDriver` the page has had all along, and the
   * same signed avatars.
   */
  const handledBy = bagsDelivered
    ? [
        assignedAgent?.givenName
          ? {
              key: "agent",
              role: "Sealed your bags at your door",
              name: assignedAgent.givenName,
              avatarUrl: agentAvatarUrl,
            }
          : null,
        driverView?.givenName
          ? {
              key: "driver",
              role: `Delivered them to ${booking.airlineIata} bag drop`,
              name: driverView.givenName,
              avatarUrl: driverView.avatarUrl,
            }
          : null,
      ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  /*
   * NOTHING ABOUT A DRIVER UNTIL THE BAGS ARE ACTUALLY SEALED — TD's call, and
   * a stricter test than the status alone on purpose.
   *
   * The verification agent is auto-assigned the moment a booking is paid, days
   * before anybody knocks. Through all of that the customer has no driver to
   * choose and nothing to watch, so a map and a shortlist would answer a
   * question they have not asked yet. The status machine already says as much:
   * `verified_sealed` is the gate, and `completeVerification` refuses to reach
   * it while any bag is unsealed (`agent-visit.ts`).
   *
   * SO WHY CHECK THE BAGS AS WELL. Because a status is a claim and a seal is
   * the fact, and the admin override can separate them — it moves a booking
   * through the state machine without touching a bag. That override is a
   * legitimate tool (an agent seals and photographs, then their phone dies
   * before the scan lands) but its cost was a page reading "Verified and
   * sealed" above a bag reading "not yet sealed", with a driver shortlist on
   * top of both.
   *
   * THE TRADE, WRITTEN DOWN: an override alone can no longer hand the customer
   * a driver. Ops asserting reality now has to be matched by bag rows that
   * carry seals. That is the right way round — the seal is the product — but it
   * does mean a force-completed booking waits for those rows. Surfacing the
   * mismatch to ops is the follow-up; quietly working around it here is not.
   */
  const bagsSealed = bags.length > 0 && bags.every((bag) => bag.sealId !== null);

  /*
   * WHETHER THE DRIVER PANEL WILL ACTUALLY DRAW ANYTHING.
   *
   * Note the last clause: `TripDriverPanel` returns null on its own when there
   * is neither a chosen driver nor an open shortlist, so holding a non-null
   * ELEMENT is not the same as having something on screen. The Pickup details
   * grid needs the real answer, because it promises "Choose yours below" — and
   * testing `driverSection !== null` gets that wrong every time the panel
   * self-suppresses, which is exactly what a booking past its bag-drop cutoff
   * does. One boolean, read by both.
   */
  const driverPanelVisible =
    !bagsDelivered && bagsSealed && (driverView !== null || canChooseDriver);

  const driverSection = !driverPanelVisible ? null : (
    <TripDriverPanel
      bookingId={booking.id}
      pickup={pickupPoint}
      pickupAddressLine={pickupAddressLine}
      choosing={canChooseDriver}
      candidates={candidateViews}
      bestShiftId={best?.shiftId ?? null}
      selected={driverView}
      live={booking.status !== "cancelled"}
      cancelled={booking.status === "cancelled"}
    />
  );

  // Bag and custody photos live in a private bucket and are stored as paths;
  // they need signing before any <img> can load them. Safe to sign here: the
  // booking has already passed the ownership check above.
  const signedUrls = await signBagPhotoUrls([
    ...bags.flatMap((bag) => bag.photoUrls),
    ...timeline.map((event) => event.photoUrl).filter((p): p is string => Boolean(p)),
  ]);

  return (
    <>
      {/* Live from here on. A signal on this booking re-runs this whole server
          component, so every card below is current without a reload — the
          timeline, the two action cards, the driver shortlist and the ETA.
          The stage is what decides whether a change is worth interrupting for;
          everything else updates quietly. */}
      <TripLive bookingId={booking.id} active={isActive} stage={liveStage} />

      <BackLink href="/trips" linkComponent={Link} className="self-start">
        All trips
      </BackLink>

      <PageHeader
        // Same rule as the trip cards: the route is what identifies a trip to
        // the person who took it, and the flight number is a detail.
        title={flightRouteLabel(booking)}
        subtitle={
          <>
            {booking.flightNumber} · {formatInstantInAirportTz(booking.departureAt, tz)} ·{" "}
            {booking.bagCount} {booking.bagCount === 1 ? "bag" : "bags"} ·{" "}
            {booking.paxName} · <span className="font-mono">{booking.ref}</span>
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

      {/* WHO CALLED IT OFF, and when. Above everything else because on a
          cancelled booking it is the only fact on the page that matters —
          every card below it describes a trip that is not happening. */}
      {cancellation && (
        <TripCancelledNotice
          by={cancellation.by}
          atLabel={formatInstantInAirportTz(cancellation.at, tz)}
          reason={cancellation.reason}
        />
      )}

      {/* What the gates decided, said out loud. A disabled control with no
          reason beside it is the same dead end as a control that silently
          fails. */}
      {actionability.blockedReason && isActive && (
        <FormMessage variant="error">{actionability.blockedReason}</FormMessage>
      )}
      {actionability.lateNotice && (
        <FormMessage variant="error">{actionability.lateNotice}</FormMessage>
      )}

      {/* Only once the deadline is close enough to be a thing somebody does
          something about — see lib/cutoff-horizon. Decided here rather than in
          the client component so the server and the browser cannot disagree
          about whether the banner exists. */}
      {cutoffAt && isActive && withinCutoffHorizon(cutoffAt, new Date()) && (
        <CutoffCountdown
          cutoffAtIso={cutoffAt.toISOString()}
          airlineIata={booking.airlineIata}
          airportCode={booking.departureAirport}
        />
      )}

      {/* Only on pickup day, and only while the booking is still live. The
          window test is here rather than in the client component so the
          server and the browser cannot disagree about whether the card
          exists — same reasoning as the cutoff banner above. */}
      {pushNotificationsEnabled() &&
        isActive &&
        withinPushPromptWindow(
          booking.pickupWindowStart,
          booking.pickupWindowEnd,
          new Date(),
        ) && <TripPushPrompt bookingId={booking.id} />}

      {/*
        THE FACTS AND THE ASKS, SIDE BY SIDE — 60/40 on a wide screen.
        Stacked below `lg`, where two columns of this content would each be
        too narrow to read.

        FLEX RATHER THAN GRID, and that is the load-bearing choice.
        `TripActionNeeded` returns `null` the moment nothing is outstanding,
        which is most of a booking's life. A grid would hold its 40% column
        open and leave a hole beside Pickup details on every trip past its
        visit. Here the sizing lives on the component itself, so when it
        disappears its basis goes with it and `grow` lets Pickup details take
        the whole row — no page-side duplicate of "is there anything to do",
        which would be a second copy of a rule that already lives in one
        place.
      */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <Card className="w-full lg:grow lg:basis-3/5">
          {/*
            THE ZONE NOTE SITS BESIDE THE TITLE, not under it. It is a footnote
            about how to read the times below, and as a full-width description
            it took a line of its own and pushed the facts down. On the right of
            the title it is available and out of the way.

            The "have your bags and passport ready" half moved OUT of here
            entirely — it is an instruction about one of the two visits, so it
            now sits with the agent who performs that visit. A note attached to
            the thing it is about does not have to name it.
          */}
          <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-1 space-y-0">
            <CardTitle className="font-display text-base">Pickup details</CardTitle>
            <CardDescription className="shrink-0">
              Times are local to {booking.departureAirport}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/*
              TWO BY TWO, so all four facts get a full column's width. Three
              columns left the address wrapping mid-street and the agent cells
              squeezed to nothing; the fourth cell was missing entirely, which
              is what made three feel like the natural number.
            */}
            <dl className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Window</dt>
                <dd className="mt-1 font-medium">
                  {booking.pickupWindowStart && booking.pickupWindowEnd
                    ? formatWindowInAirportTz(
                        booking.pickupWindowStart,
                        booking.pickupWindowEnd,
                        tz,
                      )
                    : booking.pickupWindowStart
                      ? formatInstantInAirportTz(booking.pickupWindowStart, tz)
                      : "Not scheduled yet"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="mt-1 font-medium">
                  {pickupAddress ? (
                    <>
                      {pickupAddress.line1}
                      {pickupAddress.line2 ? `, ${pickupAddress.line2}` : ""}
                      <br />
                      {pickupAddress.city}, {pickupAddress.state} {pickupAddress.zip}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {/*
                THE TWO PEOPLE, NAMED BY WHAT THEY DO — and the vocabulary is
                the page's own rather than new words invented for this grid.
                Everywhere else the customer already reads "your agent" for the
                person who checks ID and seals bags at the door, and "your
                driver" for the one who takes them to the airline: the custody
                trail says both, and the card below is titled "Your driver".
                Calling this cell a "pickup agent" would fight that three
                inches further down the page.

                The subtitle under each is what actually distinguishes them, so
                a customer meeting the words for the first time does not have to
                infer the difference.
              */}
              <div>
                <dt className="text-muted-foreground">Your agent</dt>
                <dd className="mt-1 font-medium">
                  {assignedAgent ? (
                    <span className="flex items-center gap-2">
                      <Avatar
                        size="sm"
                        name={assignedAgent.givenName}
                        src={agentAvatarUrl}
                        alt=""
                      />
                      <span>
                        {/* Real space, not margin: without it the accessible/text
                          content read "Leo· confirmed" (#51). */}
                        {assignedAgent.givenName ?? "Assigned"}{" "}
                        <span className="font-normal text-muted-foreground">
                          {AGENT_STATUS_COPY[assignedAgent.taskStatus]}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="font-normal text-muted-foreground">
                      Assigned closer to your window
                    </span>
                  )}
                </dd>
                {/*
                  THE INSTRUCTION LIVES WITH THE VISIT IT IS ABOUT. It used to
                  be half of the card's description, where it applied to
                  "your agent" without saying which one — and once there were
                  two people in this grid that was a real ambiguity rather than
                  a wording nicety. Dropped once the visit is done: telling
                  somebody to have their bags ready for a knock that already
                  happened is noise.
                */}
                <dd className="mt-1.5 text-xs text-muted-foreground">
                  Checks your ID and seals your bags at the door.
                  {preVisit ? " Please have your bags and passport ready." : ""}
                </dd>
              </div>
              {/*
                ONLY WHEN THERE IS SOMEBODY TO NAME. The empty version of this
                cell said "You'll choose once your bags are sealed" over a line
                explaining what a driver does — three lines of scaffolding for
                a fact that does not exist yet, on the card that is supposed to
                be the four things a customer needs. The grid is three cells
                until a driver is chosen, which is honest: there are three
                facts. TD's call.
              */}
              {driverView ? (
                <div>
                  <dt className="text-muted-foreground">Your driver</dt>
                  <dd className="mt-1 font-medium">
                    <span className="flex items-center gap-2">
                      <Avatar
                        size="sm"
                        name={driverView.givenName}
                        src={driverView.avatarUrl}
                        alt=""
                      />
                      <span>
                        {driverView.givenName ?? "Chosen"}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {driverView.truckName}
                        </span>
                      </span>
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        {/* Sizes ITSELF — see the note on the row above and the `className`
            prop's own note. Absent entirely once nothing is outstanding. */}
        <TripActionNeeded
          bookingId={booking.id}
          agreement={agreementView}
          passport={passportView}
          actionable={preVisit}
          className="w-full lg:basis-2/5"
        />
      </div>

      {driverSection}

      {/*
        Only once there is nothing left to watch, and only when there is
        somebody to name. A booking delivered by a driver whose row has since
        lost its name renders nothing rather than "Delivered by —".
      */}
      {handledBy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">
              Who handled your bags
            </CardTitle>
            <CardDescription>
              Every hand-off was recorded. The full trail is below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-2">
              {handledBy.map((person) => (
                <li key={person.key} className="flex items-center gap-3">
                  <Avatar size="lg" name={person.name} src={person.avatarUrl} alt="" />
                  <div className="min-w-0">
                    <p className="font-medium">{person.name}</p>
                    <p className="text-sm text-muted-foreground">{person.role}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Renders its own Card — the show/hide toggle lives in that card's
            header, so the header and the list have to share one component.
            See `CustodyTrail`. */}
        <CustodyTimeline
          events={timeline}
          tz={tz}
          signedUrls={signedUrls}
          actors={timelineActors}
        />

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-base">Bags</CardTitle>
              <CardDescription>
                Each bag gets a serialized tamper-evident seal at pickup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {bags.map((bag) => {
                  // The first signed photo is the one taken at sealing — the
                  // evidence the whole page exists to show. Unsigned paths are
                  // dropped rather than rendered as broken images.
                  const photo = bag.photoUrls
                    .map((path) => signedUrls.get(path))
                    .find(Boolean);
                  return (
                    <li
                      key={bag.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-medium">Bag {bag.ordinal}</span>
                        <span className="font-mono text-xs break-all">
                          {bag.sealId ? (
                            <>seal {bag.sealId}</>
                          ) : (
                            <span className="text-muted-foreground">not yet sealed</span>
                          )}
                          {bag.weightKg ? ` · ${bag.weightKg} kg` : null}
                        </span>
                        {/*
                          A BUTTON, NOT A THUMBNAIL — the same change the
                          custody trail gets. A 56px crop of a suitcase is not
                          information: every bag looks like every other bag at
                          that size, and the detail that makes the photo
                          evidence (the seal number on the tag) needs the
                          dialog either way. The line of text says a photo
                          exists and gets out of the way of the seal id, which
                          is the thing on this row somebody actually reads.
                        */}
                        {photo ? (
                          <ImageLightbox
                            src={photo}
                            alt={`Bag ${bag.ordinal}`}
                            title={`Bag ${bag.ordinal}`}
                            description={
                              bag.sealId ? `seal ${bag.sealId}` : "not yet sealed"
                            }
                            trigger="button"
                            triggerLabel="View seal photo"
                          />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-base">Payment</CardTitle>
              <CardDescription>
                Authorized at booking, charged only once your bags are collected and
                sealed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <span>
                        ${(payment.amountCents / 100).toFixed(2)}{" "}
                        <span className="uppercase text-muted-foreground">
                          {booking.currency}
                        </span>
                      </span>
                      {/* TODO(payments): card brand/last4 once the Stripe webhook
                      (Phase 5) stores payment-method metadata. Card-on-file is
                      deliberately out of scope. */}
                      <span className="text-xs text-muted-foreground">
                        {payment.status} · {payment.provider}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Last on the page, deliberately. Cancelling is not what this page is
          for; it is the thing a few people need on a page everybody else is
          using to watch their bags arrive. */}
      {cancelEligibility.canCancel && <TripCancel bookingId={booking.id} />}
    </>
  );
}
