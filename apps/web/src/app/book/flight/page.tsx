import { FormMessage, Input, Label, PageHeader, Select } from "@koolee/ui";
import {
  FALLBACK_DISPLAY_TZ,
  formatDateTimeLocalInAirportTz,
  resolveDisplayTz,
} from "@koolee/core";

import { submitFlight } from "@/app/book/actions";
import { TurnstileFormField } from "@/components/auth/turnstile-gate";
import { CoverageStepForm } from "@/components/coverage-step-form";
import { TicketUpload } from "@/components/ticket-upload";
import { readDraft } from "@/lib/booking-draft";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "Your flight" };
export const dynamic = "force-dynamic";

export default async function FlightStepPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const draft = await readDraft();

  const { from } = await searchParams;

  // The REVIEW FORM contract: raw extraction output lives only in the
  // quarantined `ticketPrefill` key and is used here as editable defaults.
  // Confirming this form (submitFlight) is what persists values — and the
  // prefill is cleared in the same action. Manual entries win over prefill.
  const prefill = draft.ticketPrefill;
  const fromTicket = from === "ticket" && Boolean(prefill);

  const core = tryGetCore();
  const airportTz =
    core && draft.departureAirport
      ? await resolveDisplayTz(core.db, draft.departureAirport).catch(
          () => FALLBACK_DISPLAY_TZ,
        )
      : FALLBACK_DISPLAY_TZ;
  const lowConfidence = fromTicket && prefill?.confidence === "low";

  // Extracted fields get an attention ring (sky, matching the info banner —
  // Tag Orange stays reserved for CTAs per the brand system).
  const flagged = (value: unknown) =>
    fromTicket && value !== undefined ? "border-sky-400 ring-1 ring-sky-300" : undefined;

  // A datetime-local input round-trips whatever wall clock it is given, so
  // this has to be the AIRPORT's — otherwise a customer who comes back to this
  // step finds their 6 PM departure showing as 22:00 (the server renders UTC).
  const departureAtDefault = fromTicket
    ? (prefill?.departureAtLocal ?? "")
    : draft.departureAt
      ? formatDateTimeLocalInAirportTz(new Date(draft.departureAt), airportTz)
      : "";

  const flightNumberDefault = fromTicket
    ? (prefill?.flightNumber ?? "")
    : (draft.flightNumber ?? "");
  const airportDefault = fromTicket
    ? (prefill?.departureAirport ?? draft.departureAirport ?? "JFK")
    : (draft.departureAirport ?? "JFK");
  const scopeDefault = fromTicket
    ? (prefill?.scope ?? draft.scope ?? "domestic")
    : (draft.scope ?? "domestic");
  const paxNameDefault = fromTicket ? (prefill?.paxName ?? "") : (draft.paxName ?? "");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fromTicket ? "Review your flight details" : "Your flight"}
        subtitle={
          fromTicket
            ? "Here's what we read from your ticket — check every field before continuing."
            : "Tell us where your bags are and which flight they're catching — your airline's bag-drop cutoff decides which pickup windows we can offer."
        }
      />

      {fromTicket && !lowConfidence && (
        <FormMessage variant="info">
          We filled this in from your e-ticket. The highlighted fields came from the
          upload — nothing is saved until you review and continue.
        </FormMessage>
      )}
      {lowConfidence && (
        <FormMessage variant="error">
          We weren&apos;t confident reading your ticket — please check every highlighted
          field carefully (or just type your flight in fresh).
        </FormMessage>
      )}

      <CoverageStepForm action={submitFlight} retryHref="/book/flight">
        {/* Paired rows: these six fields are short and related two at a time
            (where the bags are + which flight, which airport + when, domestic
            or not + whose name). One field per row turned a 30-second form
            into a page of scrolling. Collapses to one column on phones. */}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="zip">Pickup ZIP code</Label>
            <Input
              id="zip"
              name="zip"
              inputMode="numeric"
              placeholder="10001"
              defaultValue={draft.zip ?? ""}
              autoComplete="postal-code"
              maxLength={10}
              required
            />
            <p className="text-xs text-muted-foreground">
              We currently cover all five NYC boroughs, plus Jersey City, Hoboken, and
              the rest of Hudson County.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="flightNumber">Flight number</Label>
            <Input
              id="flightNumber"
              name="flightNumber"
              placeholder="DL123"
              defaultValue={flightNumberDefault}
              className={flagged(prefill?.flightNumber)}
              autoComplete="off"
              required
            />
          </div>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="departureAirport">Departing from</Label>
            <Select
              id="departureAirport"
              name="departureAirport"
              defaultValue={airportDefault}
              className={flagged(prefill?.departureAirport)}
              required
            >
              <option value="JFK">JFK — John F. Kennedy</option>
              <option value="LGA">LGA — LaGuardia</option>
              <option value="EWR">EWR — Newark Liberty</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="departureAt">Departure date and time</Label>
            <Input
              id="departureAt"
              name="departureAt"
              type="datetime-local"
              defaultValue={departureAtDefault}
              className={flagged(prefill?.departureAtLocal)}
              required
            />
          </div>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="scope">Destination</Label>
            <Select
              id="scope"
              name="scope"
              defaultValue={scopeDefault}
              className={flagged(prefill?.scope)}
            >
              <option value="domestic">Domestic</option>
              <option value="international">International</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              International flights usually have an earlier bag-drop cutoff.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="paxName">Name on the ticket</Label>
            <Input
              id="paxName"
              name="paxName"
              placeholder="Jordan Alvarez"
              defaultValue={paxNameDefault}
              className={flagged(prefill?.paxName)}
              autoComplete="name"
              required
            />
            <p className="text-xs text-muted-foreground">
              Our agent checks this against your photo ID at pickup.
            </p>
          </div>
        </div>

        {/* Confirming this form creates the anonymous Supabase session, which
            needs a captchaToken once CAPTCHA protection is on. Invisible;
            never blocks paint. */}
        <TurnstileFormField />
      </CoverageStepForm>

      <TicketUpload />
    </div>
  );
}
