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
  formatEtaRange,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  getBookingActionability,
  getBookingAgreementState,
  getBookingDetailForSession,
  getPassportVerification,
  getSelectedDriver,
  haversineKm,
  listCandidateDrivers,
  reportEmptyDriverPool,
  type AssignedAgent,
} from "@koolee/core";

import { CustodyTimeline } from "@/components/custody-timeline";
import { TripLive } from "@/components/trip-live";
import { CutoffCountdown } from "@/components/cutoff-countdown";
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
import { signAvatarUrlForViewer } from "@/lib/avatars";
import { pickupStepIndexFor } from "@/lib/pickup-progress";
import { signBagPhotoUrls } from "@/lib/bag-photos";
import { tryGetCore } from "@/lib/core";
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
    title: `${detail.booking.flightNumber} · ${detail.booking.departureAirport} pickup`,
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

  // The agent's face, signed SERVICE-ROLE: the customer is not staff, so
  // 0027's read policy refuses this under their own session — correctly, since
  // the only reason they may see it is that core just resolved this agent as
  // the one assigned to this booking.
  const agentAvatarUrl = await signAvatarUrlForViewer(
    assignedAgent?.avatarStoragePath ?? null,
  );

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
  const selectedDriver = await getSelectedDriver(core.db, booking.id);
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
      avatarUrl: await signAvatarUrlForViewer(candidate.avatarStoragePath),
      truckName: candidate.truckName,
      availableCapacity: candidate.availableCapacity - booking.bagCount,
      outOfZone: candidate.outOfZone,
      etaLabel: formatEtaRange(candidate.eta),
      hasEta: candidate.eta !== null,
    })),
  );

  const driverView: SelectedDriverView | null = selectedDriver
    ? {
        givenName: selectedDriver.givenName,
        avatarUrl: await signAvatarUrlForViewer(selectedDriver.avatarStoragePath),
        truckName: selectedDriver.truckName,
        etaLabel: formatEtaRange(
          selectedDriver.position && pickupAddress?.lat != null && pickupAddress.lng != null
            ? core.etaEstimator.estimate({
                from: selectedDriver.position,
                to: { lat: pickupAddress.lat, lng: pickupAddress.lng },
              })
            : null,
        ),
        distanceLabel:
          selectedDriver.position && pickupAddress?.lat != null && pickupAddress.lng != null
            ? `${haversineKm(selectedDriver.position, {
                lat: pickupAddress.lat,
                lng: pickupAddress.lng,
              }).toFixed(1)} km away`
            : null,
        lastSeenLabel: selectedDriver.positionRecordedAt
          ? formatInstantInAirportTz(selectedDriver.positionRecordedAt, tz)
          : null,
        stepIndex: pickupStepIndexFor(
          booking.status,
          selectedDriver.travelStartedAt !== null,
        ),
      }
    : null;

  const driverSection = driverView ? (
    <DriverTracking
      driver={driverView}
      live={booking.status !== "delivered_to_bagdrop" && booking.status !== "completed"}
    />
  ) : canChooseDriver ? (
    <DriverChoice bookingId={booking.id} candidates={candidateViews} />
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
          timeline, the two action cards, the driver shortlist and the ETA. */}
      <TripLive bookingId={booking.id} active={isActive} />

      <BackLink href="/trips" linkComponent={Link} className="self-start">
        All trips
      </BackLink>

      <PageHeader
        title={`${booking.flightNumber} · ${booking.departureAirport}`}
        subtitle={
          <>
            <span className="font-mono">{booking.ref}</span> ·{" "}
            {formatInstantInAirportTz(booking.departureAt, tz)} · {booking.bagCount}{" "}
            {booking.bagCount === 1 ? "bag" : "bags"} · {booking.paxName}
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

      {/* What the gates decided, said out loud. A disabled control with no
          reason beside it is the same dead end as a control that silently
          fails. */}
      {actionability.blockedReason && isActive && (
        <FormMessage variant="error">{actionability.blockedReason}</FormMessage>
      )}
      {actionability.lateNotice && (
        <FormMessage variant="error">{actionability.lateNotice}</FormMessage>
      )}

      {cutoffAt && isActive && (
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

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Your pickup</CardTitle>
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
    </>
  );
}
