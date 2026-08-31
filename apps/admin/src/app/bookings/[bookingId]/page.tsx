import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BackLink,
  Badge,
  BookingStatusBadge,
  ImageLightbox,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  formatE164ForDisplay,
  PageHeader,
} from "@koolee/ui";
import {
  avatarPathsForViewer,
  availableEvents,
  dstTransitionNote,
  EVENT_TYPES,
  getBookingAgreementState,
  getPassportVerification,
  assignmentGate,
  cancellationFromTimeline,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  getBookingAssignment,
  getSelectedDriver,
  listReassignOptions,
  getBookingActionability,
  getBookingDetailForSession,
  listAgentWorkload,
  listUserNames,
  type AdminSession,
  type AgentWorkload,
  type CoreConfig,
  type PriceBreakdown,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { TransitionControls } from "@/components/transition-controls";
import { ViewerLocalTime } from "@/components/viewer-local-time";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";
import { tagBooking } from "@/lib/sentry";
import { signAvatarUrls } from "@/lib/avatars";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { CustodyTrail, type CustodyActor } from "./custody-trail";
import {
  AssignAgentForm,
  ReassignPickupForm,
  UnassignPickupForm,
  AutoAssignButton,
  ResolveExceptionForm,
} from "./dispatch-forms";

export const dynamic = "force-dynamic";

const ALL_EVENTS = Object.keys(EVENT_TYPES);
const SIGNED_URL_TTL_SECONDS = 300;

/** Best-effort signed URLs for private bag photos (5-minute TTL). */
async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const admin = getSupabaseAdminClient();
  const map = new Map<string, string>();
  if (!admin || paths.length === 0) return map;
  const { data } = await admin.storage
    .from("bag-photos")
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${Math.abs(cents / 100).toFixed(2)}`;

/** The price snapshot, expanded. Zero-value lines are omitted, not shown as $0.00. */
function PriceBreakdownLines({ breakdown }: { breakdown: PriceBreakdown }) {
  const lines: { label: string; value: string }[] = [
    { label: "Base", value: money(breakdown.baseFeeCents) },
    { label: "Bags", value: money(breakdown.bagsCents) },
  ];
  if (breakdown.distanceCents !== 0) {
    lines.push({ label: "Distance", value: money(breakdown.distanceCents) });
  }
  if (breakdown.leadTimeAdjustmentCents !== 0) {
    lines.push({
      // The multiplier is why the number moved, so it rides the label rather
      // than sitting in a separate row an operator has to correlate.
      label: `Lead time (\u00d7${breakdown.leadTimeMultiplier})`,
      value: money(breakdown.leadTimeAdjustmentCents),
    });
  }
  for (const discount of breakdown.discounts) {
    lines.push({ label: discount.label, value: money(-Math.abs(discount.amountCents)) });
  }

  return (
    <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {lines.map((line) => (
        <span key={line.label} className="flex justify-between gap-4">
          <span>{line.label}</span>
          <span className="tabular-nums">{line.value}</span>
        </span>
      ))}
    </span>
  );
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const { bookingId } = await params;
  const core = tryGetCore();

  if (!core) {
    return (
      <ConsoleMain>
        <DatabaseNotConfigured />
      </ConsoleMain>
    );
  }

  const detail = await getBookingDetailForSession(core.db, session, bookingId).catch(
    () => null,
  );
  if (!detail) notFound();
  const { booking, timeline, bags, payments, tz } = detail;
  // Same ref the customer's trip page and the agent's task tag with, so one
  // KOO-XXXXX pulls all three apps' errors together.
  tagBooking({ ref: booking.ref, id: booking.id, userId: session.userId });
  // Non-null only on the two DST nights, when the wall-clock label is
  // ambiguous (two 1 AMs) or has a hole in it (no 2 AM).
  const windowNote = booking.pickupWindowStart
    ? dstTransitionNote(booking.pickupWindowStart, tz)
    : null;

  // Workload is read for the booking's own pickup day, not today: assigning
  // a Thursday pickup on a Tuesday should show Thursday's load.
  let agents: AgentWorkload[] = [];
  try {
    agents = await listAgentWorkload(core.db, {
      on: booking.pickupWindowStart ?? booking.departureAt,
      tz: tz,
    });
  } catch {
    // Assignment panel degrades to its empty state.
  }
  const assignment = await getBookingAssignment(core.db, booking.id).catch(() => ({
    assigneeUserId: null,
    assigneeEmail: null,
    taskStatus: null,
  }));

  const photoPaths = [
    ...bags.flatMap((bag) => bag.photoUrls),
    ...timeline.map((event) => event.photoUrl).filter((p): p is string => Boolean(p)),
  ];
  const signedUrls = await signPhotoUrls([...new Set(photoPaths)]);

  /*
   * WHO DID EACH THING, as a person.
   *
   * The trail identified every actor as eight hex characters, so
   * reconstructing a disputed hand-off meant copying ids into the staff page
   * one at a time. This is the artefact somebody reads while a customer is on
   * the phone; a name and a face are what make it readable at that moment.
   *
   * Two batched queries for the whole trail, whatever its length — an actor
   * lookup per event is one round trip per line on the page that has the most
   * lines. An admin may see anyone (`avatarPathsForViewer`), so the resolution
   * is authorized as such rather than by being on this page.
   */
  const actorIds = [
    ...new Set(
      timeline
        .map((event) => event.actorUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const actors = await resolveActors(core.db, session, actorIds);

  /*
   * WHO CANCELLED IT, said at the top rather than only in the trail.
   *
   * The trail below has carried the actor since it was written and still
   * does — this adds nothing to the record. What it adds is the ANSWER
   * without a scroll: on a cancelled booking, "was this the customer or was
   * this us?" is the first question a support call opens with, and finding it
   * meant reading a twenty-event timeline to the row that happens to say
   * `booking.cancelled`.
   *
   * Read off the timeline already loaded, not a second query.
   */
  const cancelledEvent =
    booking.status === "cancelled"
      ? timeline.find((event) => event.eventType === "booking.cancelled")
      : undefined;
  const cancellation = cancellationFromTimeline(timeline);

  /*
   * WHETHER OPS MAY STILL MOVE PEOPLE ON THIS BOOKING, from the same function
   * core refuses with. The two answers differ — the verification closes when
   * the visit is done, the pickup when the booking is — so both are asked.
   *
   * Read here rather than reasoned about in the JSX: a control hidden by one
   * rule while the server refuses by another is how an operator ends up
   * looking at a button that cannot work, or at no button when the action was
   * available all along.
   */
  const visitGate = assignmentGate(
    "verification",
    booking,
    assignment.taskStatus === "done",
  );
  const pickupGate = assignmentGate("pickup", booking, false);

  // The identity gate's two halves, read for display only. Ops cannot satisfy
  // either of them from here by design: the acceptance is the customer's act,
  // and the passport confirmation is the assigned agent's.
  // The pickup half. Both degrade to null/[] rather than failing the page: an
  // operator opening a booking to fix something must not be blocked by the
  // panel that shows what is wrong with it.
  const [selectedDriver, reassignOptions] = await Promise.all([
    getSelectedDriver(core.db, booking.id).catch(() => null),
    listReassignOptions(core.db, booking.id).catch(() => []),
  ]);

  const [agreementState, passportRow, actionability] = await Promise.all([
    getBookingAgreementState(core.db, booking.id, new Date()),
    getPassportVerification(core.db, booking.id),
    // The same object the customer's page and the agent's screen read. An
    // operator asked "why can't they accept the agreement?" needs the answer
    // the customer is looking at, not a second opinion computed differently.
    getBookingActionability(core.db, booking, new Date()),
  ]);

  const legal = availableEvents(booking.status);

  return (
    <ConsoleMain>
      <PageHeader
        title={`${booking.flightNumber} · ${booking.departureAirport}`}
        subtitle={
          <span className="font-mono text-xs">
            {/* The ref first — it is what the board lists, what the
                customer's email carries, and what ops read out loud; the full
                id stays for copy-paste and for the URL. */}
            <strong>{booking.ref}</strong> · {booking.id}
          </span>
        }
        actions={
          <>
            <BookingStatusBadge status={booking.status} />
            <BackLink href="/bookings" linkComponent={Link}>
              Back
            </BackLink>
          </>
        }
      />

      {/*
        What the gates are doing to this booking right now, in the words the
        customer and the agent are reading. Rendered ABOVE the exception
        banner but below the header: it explains the exception when there is
        one ("cutoff passed"), and warns before there is one ("running late").
        Nothing here gates the resolution form below — ops resolution goes
        through the state machine and is deliberately outside this.
      */}
      {(actionability.blockedReason ?? actionability.lateNotice) && (
        <p
          className={
            actionability.blockedReason
              ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
              : "rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-sm"
          }
        >
          <strong>
            {actionability.blockedReason
              ? "Customer and crew are blocked"
              : "Running late"}
            :
          </strong>{" "}
          {actionability.blockedReason ?? actionability.lateNotice}
        </p>
      )}

      {cancellation && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <strong>
            Cancelled by{" "}
            {cancellation.by === "customer"
              ? "the customer"
              : cancellation.by === "system"
                ? "the system"
                : "Koolee"}
          </strong>
          {cancelledEvent?.actorUserId
            ? ` (${actors.get(cancelledEvent.actorUserId)?.name ?? cancelledEvent.actorUserId.slice(0, 8)}${
                cancelledEvent.actorRole ? `, ${cancelledEvent.actorRole}` : ""
              })`
            : ""}{" "}
          · {formatInstantInAirportTz(cancellation.at, tz)}
          {cancellation.reason ? ` · ${cancellation.reason}` : ""}
        </p>
      )}

      {/* The exception banner leads. A booking that has stopped is the only
          thing on this page an operator has to act on before reading
          anything else, and it used to sit below the fold under two cards
          of reference data. */}
      {booking.status === "exception" && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base">Resolve this exception</CardTitle>
            <CardDescription>
              Resolutions run through the state machine and append a compensating custody
              event with your reason — history is never edited.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResolveExceptionForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {/*
       * Read on the left, act on the right, history underneath.
       *
       * The previous arrangement was three `lg:grid-cols-2` rows in source
       * order, which put the two controls an operator uses (assignment and
       * the manual override) at opposite ends of the page and left the
       * identity gate orphaned on a row of its own. Grouping by what the
       * operator is doing — rather than by what the data is — keeps both
       * write surfaces in view while they read the record next to them.
       */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {/*
            DETAILS AND PAYMENTS ARE ONE CARD. They were two, stacked, with a
            card boundary between "what was bought" and "what was paid for it"
            — which is one fact split across a rule. An operator checking a
            refund reads both together and never one without the other.
          */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details &amp; payments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {/* Every instant here is airport-local, matching the board — the
                  same booking must never read as two different times. */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Passenger</dt>
                <dd>{booking.paxName}</dd>
                <dt className="text-muted-foreground">Pickup window</dt>
                <dd>
                  {booking.pickupWindowStart && booking.pickupWindowEnd ? (
                    formatWindowInAirportTz(
                      booking.pickupWindowStart,
                      booking.pickupWindowEnd,
                      tz,
                    )
                  ) : booking.pickupWindowStart ? (
                    formatInstantInAirportTz(booking.pickupWindowStart, tz)
                  ) : (
                    <span className="text-muted-foreground">not scheduled</span>
                  )}
                  {/* Secondary, and only when the operator is somewhere else.
                      The line above is what the customer and agent are both
                      working from and stays the authoritative one. */}
                  {booking.pickupWindowStart && (
                    <>
                      {windowNote && (
                        <span className="ml-2 text-muted-foreground">({windowNote})</span>
                      )}
                      <ViewerLocalTime
                        instant={booking.pickupWindowStart.toISOString()}
                        tz={tz}
                        className="ml-2 text-muted-foreground"
                      />
                    </>
                  )}
                </dd>
                <dt className="text-muted-foreground">Departs</dt>
                <dd>
                  {formatInstantInAirportTz(booking.departureAt, tz)}
                  <ViewerLocalTime
                    instant={booking.departureAt.toISOString()}
                    tz={tz}
                    className="ml-2 text-muted-foreground"
                  />
                </dd>
                <dt className="text-muted-foreground">Bags</dt>
                <dd>{booking.bagCount}</dd>
                {/* The number ops rings when a customer is not at the door.
                    It has been on the booking row all along and this page
                    never rendered it, so finding it meant leaving the
                    console. `tel:` because half of dispatch is on a phone. */}
                <dt className="text-muted-foreground">Contact</dt>
                <dd>
                  {booking.contactPhone ? (
                    <a
                      href={`tel:${booking.contactPhone}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {formatE164ForDisplay(booking.contactPhone)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">none on file</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Price</dt>
                <dd className="flex flex-col gap-1">
                  <span>
                    ${(booking.priceCents / 100).toFixed(2)}{" "}
                    {booking.currency.toUpperCase()}
                  </span>
                  {/* Refund conversations are about the components, never the
                      total. The snapshot has been stored on every booking
                      since pricing shipped; the page was printing one number
                      and dropping the rest. */}
                  {booking.priceBreakdown && (
                    <PriceBreakdownLines breakdown={booking.priceBreakdown} />
                  )}
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatInstantInAirportTz(booking.createdAt, tz)}</dd>
              </dl>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="text-sm font-medium text-navy-800">Payments</h3>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payment recorded.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <span>
                          ${(payment.amountCents / 100).toFixed(2)}{" "}
                          <span className="text-xs uppercase text-muted-foreground">
                            {payment.provider}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs">
                          <Badge
                            variant={
                              payment.status === "captured" ||
                              payment.status === "authorized"
                                ? "success"
                                : payment.status === "refunded"
                                  ? "secondary"
                                  : "warning"
                            }
                          >
                            {payment.status}
                          </Badge>
                          <span className="font-mono text-muted-foreground">
                            {payment.providerRef}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/*
            THE VISIT AS ONE STORY. The identity gate and the seals were two
            cards with a rule between them, and they are two halves of one
            event: an agent stood at a door, checked a passport against a face,
            and put numbered seals on bags. Reading the second without the
            first is how somebody concludes a bag was sealed properly when the
            gate that permits sealing had not passed.
          */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verify &amp; seal</CardTitle>
              <CardDescription>
                {/* WHO DID IT, as a fact rather than a form. The forms stay in
                    the act column; what the record needs is a name, because
                    "was the gate satisfied" and "by whom" are the same
                    question on a dispute. */}
                {assignment.assigneeEmail
                  ? `${assignment.assigneeEmail} — ${assignment.taskStatus ?? "assigned"}. `
                  : "Nobody assigned yet. "}
                Both halves of the gate must hold before an agent can seal a bag. There is
                no override — a blocked agent files an exception.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">Booking agreement</span>
                  {agreementState.accepted ? (
                    <Badge variant="success">accepted</Badge>
                  ) : (
                    <Badge variant="warning">outstanding</Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {agreementState.accepted && agreementState.acceptance ? (
                    <>
                      v{agreementState.acceptedVersion?.version} ·{" "}
                      {formatInstantInAirportTz(agreementState.acceptance.acceptedAt, tz)}
                      {" · pinned"}
                    </>
                  ) : agreementState.currentVersion === null ? (
                    "No agreement is published — every visit is blocked until one is."
                  ) : (
                    <>
                      v{agreementState.currentVersion.version} not yet accepted. Only the
                      customer can do this, from their trip page.
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">Passport</span>
                  <Badge
                    variant={
                      passportRow?.status === "agent_confirmed"
                        ? "success"
                        : passportRow?.status === "failed"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {passportRow?.status ?? "pending"}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {passportRow?.confirmedAt
                    ? `Confirmed ${formatInstantInAirportTz(passportRow.confirmedAt, tz)}`
                    : passportRow?.uploadedAt
                      ? `Photo on file since ${formatInstantInAirportTz(passportRow.uploadedAt, tz)} — the agent still confirms at the door.`
                      : "Nothing uploaded. The agent photographs and confirms at the door."}
                </span>
                {/* The photo is NOT rendered here, deliberately. Ops has no
                    reason to look at a customer's passport: the check is the
                    agent's, at the door, against the person. Least privilege —
                    every surface that can display it is a surface that can leak
                    it, and this one earns nothing by having it. The storage path
                    is in the custody trail if an investigation ever needs it. */}
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-medium text-navy-800">Bags &amp; seals</h3>
                {bags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bags recorded yet.</p>
                ) : (
                  /* One card per bag, wrapping — an operator on a dispute is
                   comparing bags against each other (which seal, which photo),
                   and a stacked list makes that a scroll instead of a glance. */
                  <ul className="flex flex-wrap gap-3">
                    {bags.map((bag) => (
                      <Card asChild key={bag.id}>
                        <li className="flex w-40 flex-col gap-2 p-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-display text-sm font-semibold text-navy-800">
                              Bag {bag.ordinal}
                            </span>
                            {bag.weightKg ? (
                              <span className="text-xs text-muted-foreground">
                                {bag.weightKg} kg
                              </span>
                            ) : null}
                          </div>

                          {/* The seal id is the identifier a dispute turns on, so it
                          gets its own line in mono rather than sharing one. */}
                          <span className="font-mono text-xs break-all">
                            {bag.sealId ? (
                              bag.sealId
                            ) : (
                              <span className="text-muted-foreground">not sealed</span>
                            )}
                          </span>

                          {(() => {
                            const path = bag.photoUrls.find((p) => signedUrls.has(p));
                            if (path) {
                              return (
                                <ImageLightbox
                                  src={signedUrls.get(path)!}
                                  alt={`Bag ${bag.ordinal} evidence photo`}
                                  title={`Bag ${bag.ordinal}`}
                                  description={
                                    bag.sealId
                                      ? `seal ${bag.sealId}${bag.weightKg ? ` · ${bag.weightKg} kg` : ""}`
                                      : undefined
                                  }
                                  className="h-28 w-full"
                                />
                              );
                            }
                            return (
                              <span className="flex h-28 items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
                                {bag.photoUrls.length > 0
                                  ? "photo (signing unavailable)"
                                  : "no photo"}
                              </span>
                            );
                          })()}

                          {/* Extra photos stay reachable without stretching the card. */}
                          {bag.photoUrls.filter((p) => signedUrls.has(p)).length > 1 && (
                            <div className="flex flex-wrap gap-1">
                              {bag.photoUrls
                                .filter((p) => signedUrls.has(p))
                                .slice(1)
                                .map((path) => (
                                  <ImageLightbox
                                    key={path}
                                    src={signedUrls.get(path)!}
                                    alt={`Bag ${bag.ordinal} evidence photo`}
                                    title={`Bag ${bag.ordinal}`}
                                    className="h-10 w-10"
                                  />
                                ))}
                            </div>
                          )}
                        </li>
                      </Card>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky: dispatch reassigns while scrolling the custody trail
            looking for what went wrong. */}
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20">
          {/*
            ONE ASSIGNMENT CARD, TWO HALVES. The agent and the driver were two
            cards; they are one question asked twice — who is on this booking —
            and the two gates that answer it close at different moments, which
            is precisely the thing an operator needs to see side by side.

            IT STAYS IN THE ACT COLUMN, and that is a deliberate deviation from
            the brief, which asked for assignment to join the visit's record on
            the left. The page's own arrangement is read-left / act-right, and
            the visit's RECORD is reading while reassigning is acting. What the
            left card gained instead is the assigned agent as a FACT, so the
            visit reads as one story without the forms following it there.
          */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assignment</CardTitle>
              <CardDescription>
                One agent covers the verification visit and the pickup run in v1.
                Reassignment is allowed until the visit completes.
                {assignment.assigneeEmail
                  ? ` Currently: ${assignment.assigneeEmail} (${assignment.taskStatus ?? "assigned"}).`
                  : " Currently unassigned."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* The gate's own sentence, in place of the control it refuses.
                  A disabled button with no reason beside it is the same dead
                  end as one that silently fails. */}
              {!visitGate.allowed ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {visitGate.reason}
                </p>
              ) : (
                <AssignAgentForm
                  bookingId={booking.id}
                  agents={agents.map((agent) => {
                    const name = agent.fullName
                      ? `${agent.fullName} (${agent.email ?? agent.userId})`
                      : (agent.email ?? agent.userId);
                    // Load is on the label, not a second column: the operator is
                    // choosing inside this list and cannot see anything else.
                    return {
                      userId: agent.userId,
                      label: `${name} — ${agent.openTasks} open`,
                    };
                  })}
                  currentAssignee={assignment.assigneeUserId}
                />
              )}
              {visitGate.allowed &&
                !assignment.assigneeUserId &&
                booking.status === "paid" && <AutoAssignButton bookingId={booking.id} />}

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-medium text-navy-800">Pickup run</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedDriver
                    ? `${selectedDriver.givenName ?? "A driver"} in ${selectedDriver.truckName} — ${
                        // `travelStartedAt` stays set after the run finishes, so
                        // it only means "on the way" while the task is still open.
                        selectedDriver.taskStatus === "done"
                          ? "run complete"
                          : selectedDriver.taskStatus === "failed"
                            ? "run failed, handed to ops"
                            : selectedDriver.travelStartedAt
                              ? "on the way"
                              : "not set off yet"
                      }.`
                    : "No driver on this booking. The customer picks one once the bags are sealed; reassign here if they cannot, or if the one they picked fell through."}
                </p>
                {!pickupGate.allowed ? (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {pickupGate.reason}
                  </p>
                ) : (
                  <>
                    <ReassignPickupForm
                      bookingId={booking.id}
                      bagCount={booking.bagCount}
                      currentShiftId={selectedDriver?.shiftId ?? null}
                      options={reassignOptions.map((option) => ({
                        shiftId: option.shiftId,
                        // The free count is net of the reserve now — the same
                        // `bookableSpaces` figure the customer's shortlist filters
                        // on, so the console and the funnel cannot disagree about
                        // whether a van has room.
                        label: `${option.driverName ?? "Unnamed driver"} — ${option.truckName} (${Math.max(
                          0,
                          option.bagCapacity - option.reservedSpaces - option.bagsOnBoard,
                        )} free${option.reservedSpaces > 0 ? `, ${option.reservedSpaces} held back` : ""})`,
                        inZone: option.inZone,
                        hasRoom: option.hasRoom,
                      }))}
                    />

                    {/* Only when there IS somebody to remove. Core refuses an
                  unassign on an empty task, and an affordance that only ever
                  produces a refusal is noise. */}
                    {selectedDriver && selectedDriver.taskStatus !== "done" && (
                      <div className="border-t border-border pt-3">
                        <UnassignPickupForm
                          bookingId={booking.id}
                          driverLabel={`${selectedDriver.givenName ?? "this driver"} (${selectedDriver.truckName})`}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual state override</CardTitle>
              <CardDescription>
                Legal moves from <strong>{booking.status}</strong>:{" "}
                {legal.length > 0 ? legal.join(", ") : "none — this status is terminal"}.
                Every override is written to the custody log.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TransitionControls
                bookingId={booking.id}
                events={ALL_EVENTS}
                legalEvents={legal}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trip history</CardTitle>
          <CardDescription>
            Append-only. {timeline.length} event{timeline.length === 1 ? "" : "s"} —
            actor, timestamp, and evidence for every hand-off, including status
            transitions and every assignment or reassignment. Each line is a summary of
            the stored row; expand <strong>Raw data</strong> for the record itself.
            {/* Said out loud rather than left as an absence. There is no
                notifications table and no local record of an Inngest run, so
                "no email line" here does not mean no email was sent — it means
                this database cannot know. Building a bookkeeping table on the
                send path to make it knowable is the thing this slice
                deliberately did not do. */}{" "}
            <strong>Emails are not in this list:</strong> sends live in Inngest, not in
            this database, so their absence here is not evidence they did not happen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustodyTrail
            events={timeline}
            signedUrls={signedUrls}
            actors={actors}
            tz={tz}
          />
        </CardContent>
      </Card>
    </ConsoleMain>
  );
}

/**
 * Names and faces for a set of actor ids.
 *
 * Lives here rather than in core because the SIGNING is app-side (core reads
 * no env and holds no Supabase client) while the permission decision is core's
 * — `avatarPathsForViewer` with an admin viewer, which is the same function
 * the customer trip page and the agent visit screen go through. One rule, one
 * place, three callers.
 */
async function resolveActors(
  db: CoreConfig["db"],
  session: AdminSession,
  actorIds: readonly string[],
): Promise<Map<string, CustodyActor>> {
  if (actorIds.length === 0) return new Map();

  const [names, paths] = await Promise.all([
    listUserNames(db, actorIds),
    avatarPathsForViewer(db, { viewer: session, subjectUserIds: actorIds }),
  ]);
  const signed = await signAvatarUrls([...paths.values()]);

  const resolved = new Map<string, CustodyActor>();
  for (const id of actorIds) {
    const path = paths.get(id);
    resolved.set(id, {
      name: names.get(id) ?? null,
      avatarUrl: path ? (signed.get(path) ?? null) : null,
    });
  }
  return resolved;
}
