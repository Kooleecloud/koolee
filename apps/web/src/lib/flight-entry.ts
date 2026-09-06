import type { TypedBookingDraft } from "./booking-draft-schema";

/**
 * Which face the flight step shows.
 *
 * THE STEP HAS A DOOR NOW. Most people have their e-ticket as a PDF in their
 * inbox or a photo on their phone, and typing a flight number, an airport, a
 * date, a time and a name is the slowest possible way to tell us something we
 * can read off that document in four seconds. So the upload is the DEFAULT
 * view and the form is the alternative — the reverse of where this step
 * started, where the form filled the page and the upload card sat under a
 * divider at the bottom.
 *
 * The decision is a pure function rather than three conditions inline in the
 * page, because "does a returning customer get sent back to the door?" is the
 * kind of question that should be answerable from a test rather than from a
 * browser.
 */
export type FlightEntryMode =
  /** The upload drop area. The default for a first visit. */
  | "door"
  /** Extraction landed; the form is seeded with what we read. */
  | "review"
  /** The form, empty or as the customer left it. */
  | "manual";

export interface FlightEntryInput {
  /** `?from=ticket` — set by the upload component after a successful read. */
  from?: string | undefined;
  /** `?entry=manual` — chosen, or landed on after an unreadable file. */
  entry?: string | undefined;
  /** The draft, for the "stepping back to edit" case. */
  draft: Pick<
    TypedBookingDraft,
    | "ticketPrefill"
    | "flightEntry"
    | "flightNumber"
    | "departureAirport"
    | "departureAt"
    | "paxName"
  >;
}

/**
 * True once the draft carries a flight the customer has already confirmed.
 *
 * All four, not any: `submitFlight` writes them together, so a partial set
 * means something went wrong rather than "half answered".
 */
export function draftHasFlight(input: FlightEntryInput["draft"]): boolean {
  return Boolean(
    input.flightNumber && input.departureAirport && input.departureAt && input.paxName,
  );
}

export function flightEntryMode({
  from,
  entry,
  draft,
}: FlightEntryInput): FlightEntryMode {
  // A reading only counts when the prefill is actually there. `?from=ticket`
  // on its own — a shared link, a back button after the cookie expired — must
  // not render a "here's what we read" page with nothing in it.
  if (from === "ticket" && draft.ticketPrefill) return "review";
  if (entry === "manual") return "manual";
  // Stepping BACK to edit. Re-asking for a ticket here would read as having
  // lost their answers, which is the worst thing a funnel can imply.
  if (draftHasFlight(draft)) return "manual";
  /*
   * WE REFUSED THEM AND THEY CAME BACK. `draftHasFlight` is false — nothing
   * was committed, because the step never succeeded — and the door is exactly
   * the wrong answer: they have already told us their flight, and what we
   * said no to was their ZIP.
   *
   * This is the case the door check was missing. An out-of-area ZIP swaps the
   * form for the waitlist card, whose "Try another ZIP" is a real link back
   * to this page, and the page met them with a file-drop area and no
   * explanation.
   */
  if (draft.flightEntry) return "manual";
  return "door";
}
