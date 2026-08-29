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
  PageHeader,
} from "@koolee/ui";
import {
  availableEvents,
  dstTransitionNote,
  EVENT_TYPES,
  getBookingAgreementState,
  getPassportVerification,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  getBookingAssignment,
  getBookingDetailForSession,
  listAgentWorkload,
  type AgentWorkload,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { TransitionControls } from "@/components/transition-controls";
import { ViewerLocalTime } from "@/components/viewer-local-time";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { CustodyTrail } from "./custody-trail";
import {
  AssignAgentForm,
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

  // The identity gate's two halves, read for display only. Ops cannot satisfy
  // either of them from here by design: the acceptance is the customer's act,
  // and the passport confirmation is the assigned agent's.
  const [agreementState, passportRow] = await Promise.all([
    getBookingAgreementState(core.db, booking.id, new Date()),
    getPassportVerification(core.db, booking.id),
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
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
                <dt className="text-muted-foreground">Price</dt>
                <dd>
                  ${(booking.priceCents / 100).toFixed(2)}{" "}
                  {booking.currency.toUpperCase()}
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatInstantInAirportTz(booking.createdAt, tz)}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identity gate</CardTitle>
              <CardDescription>
                Both must hold before an agent can seal a bag. There is no override — a
                blocked agent files an exception.
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bags & seals</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        {/* Sticky: dispatch reassigns while scrolling the custody trail
            looking for what went wrong. */}
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20">
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
              {!assignment.assigneeUserId && booking.status === "paid" && (
                <AutoAssignButton bookingId={booking.id} />
              )}
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
          <CardTitle className="text-base">Custody trail</CardTitle>
          <CardDescription>
            Append-only. {timeline.length} event{timeline.length === 1 ? "" : "s"} —
            actor, timestamp, and evidence for every hand-off. Each line is a summary of
            the stored row; expand <strong>Raw data</strong> for the record itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustodyTrail events={timeline} signedUrls={signedUrls} tz={tz} />
        </CardContent>
      </Card>
    </ConsoleMain>
  );
}
