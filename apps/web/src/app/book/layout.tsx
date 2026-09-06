import Link from "next/link";
import { AppFooter, AppHeader, Button, ContentColumn } from "@koolee/ui";
import {
  FALLBACK_DISPLAY_TZ,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  resolveDisplayTz,
} from "@koolee/core";

import { BookingStepper } from "@/components/booking-stepper";
import {
  BookingSummaryShell,
  type BookingSummaryData,
} from "@/components/booking-summary-shell";
import { ContactEmailLink } from "@/components/contact-email-link";
import { readDraft } from "@/lib/booking-draft";
import { stepCompletion } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  // Freshness contract: every step submit writes the draft cookie from a
  // server action, which invalidates the router cache and re-renders this
  // layout. Plain navigation (stepper links, back button) never changes the
  // draft, so a cached render is still correct.
  const draft = await readDraft();
  const completed = stepCompletion(draft);

  // The summary must read exactly like the picker the customer just used, so
  // it resolves the zone the same way — from the chosen airport, not a
  // hardcoded Eastern default. A draft may not have an airport yet; the
  // fallback only ever applies before that step is complete.
  const core = tryGetCore();
  const tz =
    core && draft.departureAirport
      ? await resolveDisplayTz(core.db, draft.departureAirport).catch(
          () => FALLBACK_DISPLAY_TZ,
        )
      : FALLBACK_DISPLAY_TZ;

  // The chosen window lives in the draft itself — no lookup needed.
  const windowLabel =
    draft.windowStart && draft.windowEnd
      ? formatWindowInAirportTz(
          new Date(draft.windowStart),
          new Date(draft.windowEnd),
          tz,
        )
      : null;

  const summary: BookingSummaryData = {
    flight: completed[0]
      ? {
          flight: `${draft.flightNumber} from ${draft.departureAirport}`,
          departure: formatInstantInAirportTz(new Date(draft.departureAt!), tz),
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
