import Link from "next/link";
import {
  DateTimeField,
  FormMessage,
  Input,
  Label,
  OrDivider,
  PageHeader,
  Select,
} from "@koolee/ui";
import {
  FALLBACK_DISPLAY_TZ,
  formatDateTimeLocalInAirportTz,
  resolveDisplayTz,
} from "@koolee/core";

import { submitFlight, useTicketAlternativeLeg } from "@/app/book/actions";
import { TurnstileFormField } from "@/components/auth/turnstile-gate";
import { CoverageStepForm } from "@/components/coverage-step-form";
import { TicketExtractionDebug } from "@/components/ticket-extraction-debug";
import { TicketUpload } from "@/components/ticket-upload";
import { readDraft } from "@/lib/booking-draft";
import { flightEntryMode } from "@/lib/flight-entry";
import { ticketExtractionDebugEnabled, tryGetCore } from "@/lib/core";
import { describeEligibleLegs, describePrefill } from "@/lib/ticket-prefill-copy";

export const metadata = { title: "Your flight" };
export const dynamic = "force-dynamic";

export default async function FlightStepPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; entry?: string; read?: string }>;
}) {
  const draft = await readDraft();

  const { from, entry, read } = await searchParams;

  // The REVIEW FORM contract: raw extraction output lives only in the
  // quarantined `ticketPrefill` key and is used here as editable defaults.
  // Confirming this form (submitFlight) is what persists values — and the
  // prefill is cleared in the same action. Manual entries win over prefill.
  const prefill = draft.ticketPrefill;
  const fromTicket = from === "ticket" && Boolean(prefill);

  /**
   * WHAT THEY TYPED LAST TIME, IF WE REFUSED IT.
   *
   * Third in the precedence below, and only because it is only ever set when
   * the two above it are not: a rejected entry means the step did not commit,
   * so there are no committed draft values to prefer, and `submitFlight`
   * clears it the moment the step succeeds.
   *
   * Without it, a refusal cost the whole form. See `rejectedEntrySchema`.
   */
  const rejected = fromTicket ? undefined : draft.flightEntry;

  // Which face this step shows, decided once in a pure function so the
  // "somebody stepping back to edit must not be sent to the door" rule is
  // answerable from a test rather than from a browser. See lib/flight-entry.
  const showDoor = flightEntryMode({ from, entry, draft }) === "door";
  /** We took their file and could not read it. Never their fault. */
  const readFailed = read === "failed";

  const core = tryGetCore();
  const airportTz =
    core && draft.departureAirport
      ? await resolveDisplayTz(core.db, draft.departureAirport).catch(
          () => FALLBACK_DISPLAY_TZ,
        )
      : FALLBACK_DISPLAY_TZ;
  // One sentence saying WHICH leg we used and why — the difference between a
  // form that quietly decided something and one that shows its work.
  const notice = fromTicket ? describePrefill(prefill) : null;
  // Only the legs we can actually collect for — see `describeEligibleLegs`.
  // Legs out of an airport we do not serve are counted, not listed: they are
  // not choices, and an apology beside each one buried the leg that is.
  const eligible = fromTicket ? describeEligibleLegs(prefill) : { legs: [], skipped: 0 };

  // Extracted fields get an attention ring (sky, matching the info banner —
  // Tag Orange stays reserved for CTAs per the brand system).
  const flagged = (value: unknown) =>
    fromTicket && value !== undefined ? "border-sky-400 ring-1 ring-sky-300" : undefined;

  // A datetime-local input round-trips whatever wall clock it is given, so
  // this has to be the AIRPORT's — otherwise a customer who comes back to this
  // step finds their 6 PM departure showing as 22:00 (the server renders UTC).
  const departureAtDefault = fromTicket
    ? (prefill?.departureAtLocal ?? "")
    : (rejected?.departureAt ??
      (draft.departureAt
        ? formatDateTimeLocalInAirportTz(new Date(draft.departureAt), airportTz)
        : ""));
  // `rejected` wins over the committed draft wherever both exist: it is only
  // ever set when the LAST submit failed, so it holds the fresher keystrokes.
  // A customer who stepped back, retyped, and was refused must see what they
  // just typed, not what they typed successfully an hour ago.

  const flightNumberDefault = fromTicket
    ? (prefill?.flightNumber ?? "")
    : (rejected?.flightNumber ?? draft.flightNumber ?? "");
  // NEVER fall back to JFK on a ticket the extractor could not place: an
  // unchosen dropdown showing "JFK" reads as a value the customer picked.
  const airportDefault = fromTicket
    ? (prefill?.departureAirport ?? draft.departureAirport ?? "")
    : (rejected?.departureAirport ?? draft.departureAirport ?? "JFK");
  const scopeDefault = fromTicket
    ? (prefill?.scope ?? draft.scope ?? "domestic")
    : (rejected?.scope ?? draft.scope ?? "domestic");
  const paxNameDefault = fromTicket
    ? (prefill?.paxName ?? "")
    : (rejected?.paxName ?? draft.paxName ?? "");
  // Read off the ticket when we could, otherwise whatever they typed last.
  // Display only — see the column note on `bookings.destination_airport`.
  const destinationDefault = fromTicket
    ? (prefill?.destinationAirport ?? "")
    : (rejected?.destinationAirport ?? draft.destinationAirport ?? "");

  /**
   * Remount key for the form below.
   *
   * Every field here is an UNCONTROLLED input seeded by `defaultValue`, and
   * React applies `defaultValue` only on mount. After a ticket upload or a leg
   * swap the page re-renders in place (`router.refresh()`), so the already
   * mounted inputs keep their previous values while the prose around them —
   * the "we read EWR → DEL" notice, the tz hint — updates from the new
   * prefill. The result is a form that CONTRADICTS its own summary line:
   * observed as flight AI144 and "Times are EWR local" sitting above a
   * dropdown still reading JFK, an empty departure time, and Domestic on an
   * international ticket. A reload fixed it, which is exactly the signature of
   * stale mounted state.
   *
   * Keying on the seed values makes the form remount whenever what it is
   * seeded FROM changes, which is the only correct trigger.
   */
  /*
   * The refused ZIP comes BACK, deliberately. "We don't serve 90210" beside
   * an empty ZIP box asks the customer to remember what they just typed in
   * order to correct one digit of it.
   */
  const zipDefault = rejected?.zip ?? draft.zip ?? "";

  const formSeedKey = [
    fromTicket ? "ticket" : "manual",
    zipDefault,
    flightNumberDefault,
    airportDefault,
    departureAtDefault,
    scopeDefault,
    paxNameDefault,
    destinationDefault,
  ].join("|");

  if (showDoor) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Start with your ticket"
          subtitle="Upload it and we'll read the flight details off it — you check them on the next screen. Nothing is saved until you do."
        />

        <TicketUpload variant="door" />

        {/* Not a fallback, an equal path — some people have no file to hand,
            and a door with only one handle is a wall for them. */}
        <div className="flex flex-col items-center gap-1 text-sm">
          <Link
            href="/book/flight?entry=manual"
            className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-600"
          >
            Enter your flight details manually
          </Link>
          <p className="text-muted-foreground">Takes about a minute.</p>
        </div>

        {ticketExtractionDebugEnabled() && <TicketExtractionDebug />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fromTicket ? "Review your flight details" : "Your flight"}
        subtitle={
          fromTicket
            ? "Here's what we read from your ticket — check every field before continuing."
            : "Tell us where your bags are and which flight they're catching."
        }
      />

      {/* We took the file and could not read it. The tone is deliberate: the
          customer did nothing wrong, some airline PDFs are images of images,
          and the form below is the same one they would have got anyway. */}
      {readFailed && (
        <FormMessage variant="info">
          We couldn&apos;t read that one — some airline tickets are images we can&apos;t
          get text out of. Nothing&apos;s lost: fill these in and you&apos;re set, or try
          another file below.
        </FormMessage>
      )}

      {notice ? (
        <FormMessage variant={notice.tone}>{notice.text}</FormMessage>
      ) : (
        fromTicket && (
          <FormMessage variant={prefill?.confidence === "low" ? "error" : "info"}>
            We filled this in from your e-ticket. The highlighted fields came from the
            upload — nothing is saved until you review and continue.
          </FormMessage>
        )
      )}

      {/*
        WHICH FLIGHT, as a choice rather than a read-back.

        Only rendered when there is more than one to choose between: a ticket
        with a single eligible leg needs no picker, and the sentence above
        already says which leg was used. Choosing swaps the form's contents
        and puts the previous leg back in this list, so nothing is lost
        however many times somebody changes their mind.
      */}
      {eligible.legs.length > 1 && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
          <legend className="px-1 text-sm font-medium text-navy-800">
            Which flight are your bags catching?
          </legend>
          {eligible.legs.map((leg) =>
            leg.chosen ? (
              <div
                key={leg.route + (leg.flightNumber ?? "")}
                aria-current="true"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-sky-400 bg-background px-3 py-2 text-sm shadow-lift-lg ring-1 ring-sky-300"
              >
                <span className="font-medium text-navy-800">{leg.route}</span>
                {leg.flightNumber && (
                  <span className="text-muted-foreground">{leg.flightNumber}</span>
                )}
                {leg.stamp && <span className="text-muted-foreground">{leg.stamp}</span>}
                <span className="ml-auto text-xs font-medium text-sky-800">
                  Filled in below
                </span>
              </div>
            ) : (
              <form
                key={leg.route + (leg.flightNumber ?? "")}
                action={useTicketAlternativeLeg}
              >
                <input type="hidden" name="index" value={leg.alternativeIndex} />
                <button
                  type="submit"
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-sky-400 hover:bg-sky-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium text-navy-800">{leg.route}</span>
                  {leg.flightNumber && (
                    <span className="text-muted-foreground">{leg.flightNumber}</span>
                  )}
                  {leg.stamp && (
                    <span className="text-muted-foreground">{leg.stamp}</span>
                  )}
                  <span className="ml-auto text-xs font-medium text-sky-700">
                    Use this one
                  </span>
                </button>
              </form>
            ),
          )}
          {/* One line for everything we cannot serve, not one line each. */}
          {eligible.skipped > 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              {eligible.skipped === 1
                ? "One other flight on this ticket doesn't leave New York, so we can't collect for it."
                : `${eligible.skipped} other flights on this ticket don't leave New York, so we can't collect for them.`}
            </p>
          )}
        </fieldset>
      )}

      <CoverageStepForm key={formSeedKey} action={submitFlight} retryHref="/book/flight">
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
              defaultValue={zipDefault}
              autoComplete="postal-code"
              maxLength={10}
              required
            />
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
              {airportDefault === "" && (
                <option value="" disabled>
                  Choose your departure airport
                </option>
              )}
              <option value="JFK">JFK — John F. Kennedy</option>
              <option value="LGA">LGA — LaGuardia</option>
              <option value="EWR">EWR — Newark Liberty</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="departureAt">Departure date and time</Label>
            {/*
              Posts the same `datetime-local` wall-clock string the native input
              did, so `submitFlight` is untouched. Native `required` does not
              apply to the hidden field behind this control — the action already
              rejects an empty value with "Enter your departure date and time."
            */}
            <DateTimeField
              id="departureAt"
              name="departureAt"
              defaultValue={departureAtDefault}
              triggerClassName={flagged(prefill?.departureAtLocal)}
              hint={
                airportDefault
                  ? `Times are ${airportDefault} local`
                  : "Times are local to your departure airport"
              }
            />
          </div>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            {/* "Trip type", not "Destination" — this picks a bag-drop cutoff
                (45 vs 60 minutes), and sitting next to a field that asks
                where you are flying to, the old label read as the same
                question asked twice. */}
            <Label htmlFor="scope">Trip type</Label>
            <Select
              id="scope"
              name="scope"
              defaultValue={scopeDefault}
              className={flagged(prefill?.scope)}
            >
              <option value="domestic">Domestic</option>
              <option value="international">International</option>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="destinationAirport">Flying to (optional)</Label>
            <Input
              id="destinationAirport"
              name="destinationAirport"
              placeholder="LAX"
              maxLength={3}
              defaultValue={destinationDefault}
              className={flagged(prefill?.destinationAirport)}
              autoComplete="off"
            />
            {/*
              Says what it is FOR. Nobody volunteers an airport code to a form
              that does not explain itself, and this one earns its place only
              on the trips list months later.
            */}
            <p className="text-xs text-muted-foreground">
              Airport code — it&apos;s how you&apos;ll recognise this trip later.
            </p>
          </div>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
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
          </div>
        </div>

        {/* Confirming this form creates the anonymous Supabase session, which
            needs a captchaToken once CAPTCHA protection is on. Invisible;
            never blocks paint. */}
        <TurnstileFormField />
      </CoverageStepForm>

      {/* No divider above a ticket-filled form: an "or" between a form we
          just filled in and an upload card offers a choice the customer has
          already made. It stays in the manual modes, where the two really are
          alternatives. */}
      {!fromTicket && <OrDivider />}

      {/* Still here in every mode: somebody who started typing, whose first
          file failed, or who uploaded the wrong ticket can hand us another
          document. The words change — see `replacing`. */}
      <TicketUpload replacing={fromTicket} />

      {ticketExtractionDebugEnabled() && <TicketExtractionDebug />}
    </div>
  );
}
