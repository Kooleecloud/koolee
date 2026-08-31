import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
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
  getBookingDraft,
  getCustomerById,
  listCustomerTrips,
  profileCompleteness,
  type CustomerTrips,
} from "@koolee/core";

import { discardDraft } from "@/app/trips/actions";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { ProfileCompletenessCard } from "@/components/profile-completeness-card";
import { TripLive } from "@/components/trip-live";
import { PastTripCard, UpcomingTripCard } from "@/components/trip-card";
import { getAuthUser } from "@/lib/auth";
import { bookingDraftSchema, type TypedBookingDraft } from "@/lib/booking-draft-schema";
import { BOOKING_STEPS, draftHasProgress, nextIncompleteStep } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

export const metadata = { title: "My Trips" };
export const dynamic = "force-dynamic";

/**
 * The post-login landing page.
 *
 * It used to be one undifferentiated list, newest booking first, with a
 * cancelled trip from March sitting above tomorrow's pickup and nothing on any
 * card saying which of them needed something from the customer. Three changes,
 * all of them about ORDER OF ATTENTION:
 *
 *  1. **Upcoming and Past are separate.** Past is anything terminal or whose
 *     flight has gone — see `listCustomerTrips`, which owns that judgement.
 *  2. **Upcoming is soonest first**, not newest first. What is about to happen
 *     matters more than what was booked most recently.
 *  3. **Needs-action badges** on the card, driven by F1's actionability
 *     service. A customer with an unaccepted agreement used to find out when
 *     an agent was standing at their door unable to proceed.
 *
 * The trip page keeps its URL; this only organises the way in.
 */
export default async function TripsPage() {
  // The proxy gates this route; re-check here so the query is always scoped.
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/login?returnTo=%2Ftrips");

  const core = tryGetCore();
  const session = customerSessionFromAuthUser(authUser);

  let trips: CustomerTrips = { upcoming: [], past: [] };
  let unavailable = core === null;
  let missing: ReturnType<typeof profileCompleteness>["missing"] = [];

  if (core) {
    try {
      const [loaded, userRow] = await Promise.all([
        listCustomerTrips(core.db, session, new Date()),
        getCustomerById(core.db, authUser.id).catch(() => null),
      ]);
      trips = loaded;
      missing = profileCompleteness(userRow).missing;
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

  const nothingAtAll =
    trips.upcoming.length === 0 && trips.past.length === 0 && draft === null;

  return (
    <div className="flex flex-col gap-8">
      {/* No booking id: this list watches everything RLS lets the viewer see,
          which for a customer is exactly their own bookings. A needs-action
          badge appearing here without a reload is the point. */}
      <TripLive />

      {/*
        NO ACTION ON THIS HEADER. "Book a pickup" already sits in the app
        header two inches above it, and again inside whichever empty state is
        showing — three identical orange buttons on one screen, two of them
        within a hand's width of each other. The header's is the persistent
        one and the empty state's is the contextual one; this middle copy was
        the one that said nothing the other two did not.
      */}
      <PageHeader title="My Trips" />

      {/* Renders nothing when the profile is done — see the component. */}
      <ProfileCompletenessCard missing={missing} />

      {draft && <DraftCard draft={draft} updatedAt={draftUpdatedAt} />}

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : nothingAtAll ? (
        <EmptyState
          title="No trips yet"
          description="Book a pickup and your live chain-of-custody timeline will appear here."
          action={
            <CTAButton asChild>
              <Link href="/book">Book a pickup</Link>
            </CTAButton>
          }
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-navy-800">Upcoming</h2>
            {trips.upcoming.length === 0 ? (
              /* Not apologetic: somebody with only past trips is a returning
                 customer, and the right thing to say to them is "book the
                 next one", not "you have nothing". */
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nothing booked right now</CardTitle>
                  <CardDescription>
                    Your next pickup will show up here with a live timeline the moment
                    it&apos;s confirmed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CTAButton asChild>
                    <Link href="/book">Book a pickup</Link>
                  </CTAButton>
                </CardContent>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {trips.upcoming.map((trip) => (
                  <li key={trip.booking.id}>
                    <UpcomingTripCard trip={trip} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {trips.past.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold text-navy-800">
                Past trips
              </h2>
              <ul className="flex flex-col gap-2">
                {trips.past.map((trip) => (
                  <li key={trip.booking.id}>
                    <PastTripCard trip={trip} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
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
    <Card className="border-sky-200 bg-sky-50/50">
      <CardHeader>
        <CardTitle className="text-base">
          Booking in progress
          {draft.flightNumber && draft.departureAirport && (
            <>
              {" "}
              — {draft.flightNumber} from {draft.departureAirport}
            </>
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
          . Drafts are kept for 7 days.
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
