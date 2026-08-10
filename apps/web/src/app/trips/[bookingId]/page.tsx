import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  BackLink,
  BookingStatusBadge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  PageHeader,
} from "@koolee/ui";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  getBookingDetailForSession,
  type AssignedAgent,
} from "@koolee/core";

import { CustodyTimeline } from "@/components/custody-timeline";
import { CutoffCountdown } from "@/components/cutoff-countdown";
import { tryGetCore } from "@/lib/core";
import { getCustomerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const result = await getBookingDetailForSession(core.db, session, bookingId).catch(
    () => null,
  );
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

  const isActive = !["completed", "cancelled"].includes(booking.status);

  return (
    <>
      <BackLink href="/trips" linkComponent={Link} className="self-start">
        All trips
      </BackLink>

      <PageHeader
        title={`${booking.flightNumber} · ${booking.departureAirport}`}
        subtitle={
          <>
            {format(booking.departureAt, "EEE d MMM yyyy, h:mm a")} · {booking.bagCount}{" "}
            {booking.bagCount === 1 ? "bag" : "bags"} · {booking.paxName}
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

      {cutoffAt && isActive && (
        <CutoffCountdown
          cutoffAtIso={cutoffAt.toISOString()}
          airlineIata={booking.airlineIata}
          airportCode={booking.departureAirport}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Your pickup</CardTitle>
          <CardDescription>
            Times are local to {booking.departureAirport}. Please have your bags and
            photo ID ready when your agent arrives.
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
                  <>
                    {assignedAgent.givenName ?? "Assigned"}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {AGENT_STATUS_COPY[assignedAgent.taskStatus]}
                    </span>
                  </>
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

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Chain of custody</CardTitle>
            <CardDescription>Every hand-off, recorded as it happens.</CardDescription>
          </CardHeader>
          <CardContent>
            <CustodyTimeline events={timeline} />
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
                {bags.map((bag, index) => (
                  <li
                    key={bag.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span>Bag {index + 1}</span>
                    <span className="font-mono text-xs">
                      {bag.sealId ? (
                        <>seal {bag.sealId}</>
                      ) : (
                        <span className="text-muted-foreground">not yet sealed</span>
                      )}
                      {bag.weightKg ? ` · ${bag.weightKg} kg` : null}
                    </span>
                  </li>
                ))}
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
