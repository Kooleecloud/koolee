import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Plane } from "lucide-react";
import {
  BookingStatusBadge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CTAButton,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { redirect } from "next/navigation";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  getBookingDraft,
  getDisplayZones,
  listBookingsForSession,
  zoneFor,
  type Booking,
} from "@koolee/core";

import { discardDraft } from "@/app/trips/actions";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { getAuthUser } from "@/lib/auth";
import { bookingReference } from "@/lib/booking-reference";
import { bookingDraftSchema, type TypedBookingDraft } from "@/lib/booking-draft-schema";
import { BOOKING_STEPS, draftHasProgress, nextIncompleteStep } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

export const metadata = { title: "My Trips" };
export const dynamic = "force-dynamic";

export default async function TripsPage() {
  // The proxy gates this route; re-check here so the query is always scoped.
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/login?returnTo=%2Ftrips");

  const core = tryGetCore();

  let bookings: Booking[] = [];
  // Airport code → IANA zone. A trips list can span airports, so the zone is
  // resolved per booking rather than assumed — and one query covers the lot.
  let zones: Record<string, string> = {};
  let unavailable = core === null;

  if (core) {
    try {
      // Session-scoped in core: a customer session can only ever list its own.
      [bookings, zones] = await Promise.all([
        listBookingsForSession(core.db, customerSessionFromAuthUser(authUser), {
          limit: 50,
        }),
        getDisplayZones(core.db),
      ]);
    } catch {
      unavailable = true;
    }
  }

  // An in-progress funnel draft (unexpired, not discarded) shows as a
  // resumable card — abandoning mid-booking must not look like data loss.
  let draft: TypedBookingDraft | null = null;
  let draftUpdatedAt: Date | null = null;
  if (core) {
    try {
      const row = await getBookingDraft(core.db, authUser.id);
      const parsed = row ? bookingDraftSchema.safeParse(row.payload) : null;
      if (parsed?.success && draftHasProgress(parsed.data)) {
        draft = parsed.data;
        draftUpdatedAt = row?.updatedAt ?? null;
      }
    } catch {
      // Best-effort: trips render fine without the draft card.
    }
  }

  return (
    <>
      <PageHeader title="My Trips" />

      {draft && <DraftCard draft={draft} updatedAt={draftUpdatedAt} />}

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : bookings.length === 0 && !draft ? (
        <EmptyState
          title="No trips yet"
          description="Book a pickup and your live chain-of-custody timeline will appear here."
          action={
            <CTAButton asChild>
              <Link href="/book">Book a pickup</Link>
            </CTAButton>
          }
        />
      ) : bookings.length === 0 ? null : (
        <ul className="flex flex-col gap-3">
          {bookings.map((booking) => {
            const tz = zoneFor(zones, booking.departureAirport);
            const window =
              booking.pickupWindowStart && booking.pickupWindowEnd
                ? formatWindowInAirportTz(
                    booking.pickupWindowStart,
                    booking.pickupWindowEnd,
                    tz,
                  )
                : booking.pickupWindowStart
                  ? formatInstantInAirportTz(booking.pickupWindowStart, tz)
                  : "Not scheduled yet";
            return (
              <li key={booking.id}>
                <Link
                  href={`/trips/${booking.id}`}
                  className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-start justify-between gap-4">
                    <span className="flex flex-col gap-1">
                      <span className="font-display font-semibold text-navy-800">
                        {booking.flightNumber} · {booking.departureAirport}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Plane aria-hidden className="size-3.5 shrink-0 text-sky-700" />
                        {formatInstantInAirportTz(booking.departureAt, tz)}
                      </span>
                    </span>
                    <BookingStatusBadge status={booking.status} />
                  </span>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
                    <TripFact label="Pickup window" value={window} />
                    <TripFact label="Passenger" value={booking.paxName} />
                    <TripFact
                      label="Bags"
                      value={`${booking.bagCount} ${booking.bagCount === 1 ? "bag" : "bags"}`}
                    />
                    {/* "Total", not "Paid" — a booking can sit unpaid, and
                        `priceCents` is the quote either way. */}
                    <TripFact
                      label="Total"
                      value={`$${(booking.priceCents / 100).toFixed(2)} ${booking.currency.toUpperCase()}`}
                    />
                    <TripFact label="Reference" value={bookingReference(booking.id)} />
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** One labelled fact inside a trip card. */
function TripFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy-800">{value}</dd>
    </div>
  );
}

/**
 * Resumable in-progress booking. "Resume" goes through /book, which
 * rehydrates the funnel cookie from the server draft when needed — that is
 * what makes a draft survive a browser switch. Drafts expire 7 days after
 * the last edit.
 */
function DraftCard({
  draft,
  updatedAt,
}: {
  draft: TypedBookingDraft;
  updatedAt: Date | null;
}) {
  const nextHref = nextIncompleteStep(draft);
  const nextLabel =
    BOOKING_STEPS.find((step) => step.href === nextHref)?.label ?? "Review & pay";

  return (
    <Card className="mb-6 border-sky-200 bg-sky-50/50">
      <CardHeader>
        <CardTitle className="text-base">
          Booking in progress
          {draft.flightNumber && draft.departureAirport && (
            <> — {draft.flightNumber} from {draft.departureAirport}</>
          )}
        </CardTitle>
        <CardDescription>
          Next step: {nextLabel}
          {/* Relative, not a wall-clock time: this is the customer's own last
              action, and a draft may not have an airport yet — so there is no
              booking zone to render it in. Elapsed time needs no zone at all. */}
          {updatedAt && (
            <> · last edited {formatDistanceToNow(updatedAt, { addSuffix: true })}</>
          )}
          .
          Drafts are kept for 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <CTAButton asChild>
          <Link href="/book">Resume booking</Link>
        </CTAButton>
        <ConfirmActionForm
          action={discardDraft}
          title="Discard this booking?"
          description="Everything you've entered will be removed. This cannot be undone."
          confirmLabel="Discard"
        >
          {/* h-11/px-6 matches the CTAButton beside it — the two default
              heights differ (h-9 vs h-11) and read as a mistake side by side. */}
          <Button type="button" variant="outline" className="h-11 px-6">
            Discard
          </Button>
        </ConfirmActionForm>
      </CardContent>
    </Card>
  );
}
