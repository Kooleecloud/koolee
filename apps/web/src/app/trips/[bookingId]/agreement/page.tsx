import { notFound } from "next/navigation";
import { Markdown } from "@koolee/ui";
import {
  formatInstantInAirportTz,
  getBookingAgreementState,
  getBookingDetailForSession,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getCustomerSession } from "@/lib/session";

import { PrintOnLoad } from "./print-on-load";

/**
 * The booking's agreement, as a document you can keep.
 *
 * WHY THIS IS A PAGE AND NOT A GENERATED PDF. The customer's ask is "let me
 * read it again and save it" — and every browser already turns a print view
 * into a PDF, on every platform, with no dependency. A real PDF pipeline
 * (pdfkit, a headless Chromium, a font bundle) would be a build surface and a
 * runtime to maintain for an artefact whose entire job is to be legible and
 * keepable. If a signed, archival PDF is ever a legal requirement, that is a
 * different artefact and it belongs on the server beside the acceptance
 * record, not here.
 *
 * WHICH VERSION IT SHOWS. The one this booking is BOUND by — the accepted
 * version, pinned — and only otherwise what a new acceptance would pin to.
 * Downloading v2 for a trip that accepted v1 would be worse than offering no
 * download at all. See `getBookingAgreementState`.
 *
 * AUTHORIZATION IS THE SAME DOOR AS THE TRIP PAGE. `getBookingDetailForSession`
 * 404s on somebody else's booking, so an agreement URL is exactly as private
 * as the trip it belongs to.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return { title: `Koolee booking agreement · ${bookingId.slice(0, 8)}` };
}

export default async function AgreementPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;

  const core = tryGetCore();
  if (!core) notFound();

  const session = await getCustomerSession();
  if (!session) notFound();

  const detail = await getBookingDetailForSession(core.db, session, bookingId).catch(
    () => null,
  );
  if (!detail) notFound();

  const state = await getBookingAgreementState(core.db, bookingId, new Date());
  const version = state.acceptedVersion ?? state.currentVersion;
  if (!version) notFound();

  const { booking, tz } = detail;

  return (
    <main className="mx-auto flex max-w-[42rem] flex-col gap-6 px-6 py-10 print:max-w-none print:px-0 print:py-0">
      {/* Opens the browser's print dialog on arrival — "Save as PDF" is one of
          its destinations on every platform. Deliberately not automatic on a
          re-render: see the component. */}
      <PrintOnLoad />

      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Koolee</p>
        <h1 className="font-display text-2xl font-semibold text-navy-800">
          {version.title}
        </h1>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <dt>Version</dt>
          <dd>{version.version}</dd>
          <dt>Booking</dt>
          <dd className="font-mono">{booking.ref}</dd>
          <dt>Passenger</dt>
          <dd>{booking.paxName}</dd>
          <dt>Flight</dt>
          <dd>
            {booking.flightNumber} from {booking.departureAirport},{" "}
            {formatInstantInAirportTz(booking.departureAt, tz)}
          </dd>
          {/* The acceptance is the point of keeping this: it says WHO agreed to
              WHAT and WHEN. A copy without it is just the terms. */}
          {state.acceptance ? (
            <>
              <dt>Accepted</dt>
              <dd>{formatInstantInAirportTz(state.acceptance.acceptedAt, tz)}</dd>
            </>
          ) : (
            <>
              <dt>Status</dt>
              <dd>Not yet accepted</dd>
            </>
          )}
        </dl>
      </header>

      <article className="text-sm leading-relaxed">
        <Markdown>{version.bodyMd}</Markdown>
      </article>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        These are the terms for booking {booking.ref}. A later update to the agreement
        does not change them.
      </footer>
    </main>
  );
}
