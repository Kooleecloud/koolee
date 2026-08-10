import Link from "next/link";
import { format } from "date-fns";
import { AppFooter, AppHeader, Button, ContentColumn } from "@koolee/ui";
import { formatWindowInAirportTz } from "@koolee/core";

import { BookingStepper } from "@/components/booking-stepper";
import {
  BookingSummaryShell,
  type BookingSummaryData,
} from "@/components/booking-summary-shell";
import { ContactEmailLink } from "@/components/contact-email-link";
import { readDraft } from "@/lib/booking-draft";
import { stepCompletion } from "@/lib/booking-steps";

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  // Freshness contract: every step submit writes the draft cookie from a
  // server action, which invalidates the router cache and re-renders this
  // layout. Plain navigation (stepper links, back button) never changes the
  // draft, so a cached render is still correct.
  const draft = await readDraft();
  const completed = stepCompletion(draft);

  // The chosen window lives in the draft itself — no lookup needed.
  const windowLabel =
    draft.windowStart && draft.windowEnd
      ? formatWindowInAirportTz(
          new Date(draft.windowStart),
          new Date(draft.windowEnd),
          "America/New_York",
        )
      : null;

  const summary: BookingSummaryData = {
    flight: completed[0]
      ? {
          flight: `${draft.flightNumber} from ${draft.departureAirport}`,
          departure: format(new Date(draft.departureAt!), "EEE d MMM, h:mm a"),
          pax: draft.paxName ?? "",
        }
      : null,
    pickup: completed[1]
      ? {
          address: `${draft.line1}${draft.line2 ? `, ${draft.line2}` : ""}, ${draft.city} ${draft.state} ${draft.zip}`,
          bags: `${draft.bagCount} ${draft.bagCount === 1 ? "bag" : "bags"}`,
        }
      : null,
    window: windowLabel,
  };

  return (
    <div className="min-h-dvh">
      <AppHeader
        linkComponent={Link}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">My Trips</Link>
          </Button>
        }
      />

      <BookingStepper completed={completed} />

      {/* Guided step flow: stays a focused column, unlike the account pages.
          On desktop, a left rail summarises the completed steps' answers. */}
      <BookingSummaryShell summary={summary}>
        <ContentColumn width="focused">{children}</ContentColumn>
      </BookingSummaryShell>

      <AppFooter width="focused">
        Every pickup is ID-verified, sealed with a serialized tag, and photographed at
        each hand-off. Questions? <ContactEmailLink />
      </AppFooter>
    </div>
  );
}
