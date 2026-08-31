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

import { CustodyTimeline } from "@/components/custody-timeline";
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
  DriverChoice,
  DriverTracking,
  type DriverCandidateView,
  type SelectedDriverView,
} from "@/components/trip-driver";
import { signAvatarUrlsForBooking, signShortlistAvatarUrl } from "@/lib/avatars";
import { flightRouteLabel, flightRouteText } from "@/lib/flight-label";
import { pickupStepIndexFor } from "@/lib/pickup-progress";
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
    effectiveLabel: agreementVersion
      ? formatInstantInAirportTz(agreementVersion.effectiveFrom, tz)
      : null,
    accepted: agreementState.accepted,
    acceptedAtLabel: agreementState.acceptance
      ? formatInstantInAirportTz(agreementState.acceptance.acceptedAt, tz)
      : null,
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
      // For the map. Null is ordinary — a phone in a pocket stops reporting —
      // and such a driver keeps their card while having no pin.
      position: candidate.position,
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
         * Only a FRESH fix reaches the map. `driver_positions` keeps one
         * mutable row per driver with no history, so a driver who has been
         * chosen but has not set off yet — or whose phone went into a pocket
         * — still has a position on file, possibly from yesterday's job.
         * Drawing that puts a van on a street it left hours ago, looking
         * exactly as live as a real one. Stale degrades to what this card
         * said before there was a map: a distance, and "Position updating".
         */
        position: selectedDriver.positionIsFresh ? selectedDriver.position : null,
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

  const driverSection = driverView ? (
    <DriverTracking
      driver={driverView}
      live={
        booking.status !== "delivered_to_bagdrop" &&
        booking.status !== "completed" &&
        booking.status !== "cancelled"
      }
      // The card stays on a cancelled booking, struck through rather than
      // removed: the leg existed, and a page that forgets it is a page that
      // cannot answer "who was coming?".
      cancelled={booking.status === "cancelled"}
      pickup={pickupPoint}
    />
  ) : canChooseDriver ? (
    <DriverChoice
      bookingId={booking.id}
      candidates={candidateViews}
      pickup={pickupPoint}
    />
  ) : null;

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

      <TripActionNeeded
        bookingId={booking.id}
        agreement={agreementView}
        passport={passportView}
        actionable={preVisit}
      />

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

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Pickup details</CardTitle>
          <CardDescription>
            Times are local to {booking.departureAirport}. Please have your bags and your
            passport ready when your agent arrives.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
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
            <div>
              <dt className="text-muted-foreground">Agent</dt>
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
            </div>
          </dl>
        </CardContent>
      </Card>

      {driverSection}

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Chain of custody</CardTitle>
            <CardDescription>Every hand-off, recorded as it happens.</CardDescription>
          </CardHeader>
          <CardContent>
            <CustodyTimeline events={timeline} tz={tz} signedUrls={signedUrls} />
          </CardContent>
        </Card>

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
                      {photo ? (
                        <ImageLightbox
                          src={photo}
                          alt={`Bag ${bag.ordinal}`}
                          title={`Bag ${bag.ordinal}`}
                          description={
                            bag.sealId ? `seal ${bag.sealId}` : "not yet sealed"
                          }
                          className="h-14 w-14 shrink-0"
                        />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
                          no photo
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">Bag {bag.ordinal}</span>
                        <span className="font-mono text-xs break-all">
                          {bag.sealId ? (
                            <>seal {bag.sealId}</>
                          ) : (
                            <span className="text-muted-foreground">not yet sealed</span>
                          )}
                          {bag.weightKg ? ` · ${bag.weightKg} kg` : null}
                        </span>
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
