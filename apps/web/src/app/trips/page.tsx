import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
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
  getBookingDraft,
  getDisplayZones,
  listBookingsForSession,
  zoneFor,
  type Booking,
} from "@koolee/core";

import { discardDraft } from "@/app/trips/actions";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { getAuthUser } from "@/lib/auth";
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
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={`/trips/${booking.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-display font-semibold text-navy-800">
                    {booking.flightNumber} · {booking.departureAirport}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatInstantInAirportTz(
                      booking.departureAt,
                      zoneFor(zones, booking.departureAirport),
                    )}{" "}
                    ·{" "}
                    {booking.bagCount} {booking.bagCount === 1 ? "bag" : "bags"}
                  </span>
                </span>
                <BookingStatusBadge status={booking.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
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
