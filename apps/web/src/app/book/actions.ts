"use server";

import { redirect } from "next/navigation";
import {
  airportLocalDateTime,
  checkCoverage,
  ConflictError,
  createBooking,
  discardBookingDraft,
  FALLBACK_DISPLAY_TZ,
  listBookableWindows,
  OutOfCoverageError,
  QuoteZipMismatchError,
  recordWaitlistSignup,
  resolveDisplayTz,
  resolveQuoteDistanceKm,
  SlotNotSellableError,
  softDeleteBookingDraft,
  type AirportCode,
  type CutoffScope,
} from "@koolee/core";

import { ensureDraftSession } from "@/actions/auth";
import { getAuthUser } from "@/lib/auth";
import { emitBookingConfirmed } from "@/lib/booking-events";
import { clearDraft, readDraft, writeDraft } from "@/lib/booking-draft";
import type { PrefillAlternative } from "@/lib/booking-draft-schema";
import { nextIncompleteStep } from "@/lib/booking-steps";
import { buildCheckoutSetup, isDraftReadyForPayment } from "@/lib/checkout";
import { getCore, tryGetCore } from "@/lib/core";
import { syncDraftRow } from "@/lib/draft-sync";
import { toE164UsCa } from "@/lib/phone";

/**
 * Server actions for the booking flow.
 *
 * Thin adapters: parse the form, call a `@koolee/core` service, translate the
 * typed error into something the form can render. No domain logic lives here.
 *
 * Funnel order (4 visible steps): flight (ZIP + flight details, or ticket
 * PDF → review) → pickup (address + bags) → window → review & pay. Verify —
 * the only auth gate — sits inside the last step. Every submit lands on
 * `nextIncompleteStep`, so an edit from a later step returns straight to the
 * frontier instead of re-walking the funnel.
 */

export interface ActionState {
  error?: string;
  /** Set when the ZIP is outside the service area, to show the email capture. */
  outOfCoverageZip?: string;
  /**
   * Set when the address entered at the pickup step is in a different ZIP
   * from the one the quote was built for. Not an error — the form offers to
   * re-quote for the new ZIP, or to go back and use another address.
   */
  zipMismatch?: { quotedZip: string; addressZip: string };
  ok?: boolean;
}

const AIRPORTS: AirportCode[] = ["JFK", "LGA", "EWR"];

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ */
/* Start over — discard the draft and reset the funnel                  */
/* ------------------------------------------------------------------ */

/**
 * The funnel's escape hatch (stepper bar, the no-windows dead end, and My
 * Trips' Discard). Clears the cookie, soft-deletes the mirror row, and — if
 * the payment step already created a draft booking — voids its authorization
 * through core's ownership- and status-gated discard. Never blocks on the
 * cleanup: the reset must always succeed.
 */
export async function startOverBooking(): Promise<void> {
  const draft = await readDraft();
  const authUser = await getAuthUser();
  const core = tryGetCore();

  if (core && authUser) {
    try {
      await discardBookingDraft(core, {
        userId: authUser.id,
        bookingId: draft.bookingId ?? null,
        reason: "booking_draft_discarded",
      });
    } catch (error) {
      console.error("[book] draft discard failed", error);
    }
  }

  await clearDraft();
  redirect("/book/flight");
}

/** Out-of-area waitlist: persists to `waitlist_signups` via core. */
export async function captureOutOfAreaEmail(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = str(form, "email");
  const zip = str(form, "zip");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Enter a valid email address.", outOfCoverageZip: zip };
  }
  if (!/^\d{5}$/.test(zip)) {
    return {
      error: "That ZIP code doesn't look right — go back and re-enter it.",
      outOfCoverageZip: zip,
    };
  }

  const core = tryGetCore();
  if (!core) {
    return {
      error: "We can't save signups right now — please try again in a few minutes.",
      outOfCoverageZip: zip,
    };
  }

  // The "your zone opened" email is owned by the daily waitlist sweep
  // (waitlist-zone-opened-sweep in @koolee/core jobs): it scans rows with
  // notified_at IS NULL against live coverage and stamps on send.
  try {
    await recordWaitlistSignup(core.db, { email, zip, source: "booking_out_of_area" });
  } catch (error) {
    console.error("[waitlist] failed to persist out-of-area signup", error);
    return {
      error: "Something went wrong saving your spot — please try again.",
      outOfCoverageZip: zip,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Step 1 — flight (ZIP + manual entry, or ticket PDF → editable review) */
/* ------------------------------------------------------------------ */

/*
 * Ticket upload + extraction lives in /api/ticket-uploads (route handler:
 * private-bucket storage, ticket_uploads row, synchronous extraction).
 * Extracted values land ONLY in the quarantined `ticketPrefill` cookie key,
 * which the flight review form reads as editable defaults. Confirming that
 * form (`submitFlight` below) is what promotes user-confirmed values into
 * the real draft keys — and clears the prefill.
 */

/**
 * "Use the other leg instead" on a round-trip ticket.
 *
 * Swaps the chosen leg with one of the alternatives the extractor recorded,
 * inside the quarantined prefill ONLY — nothing here touches a booking field,
 * and the customer still confirms the review form afterwards. The leg being
 * replaced becomes an alternative in turn, so the swap is reversible.
 *
 * `scope` comes from the CHOSEN leg's own reading, not from the leg being
 * replaced. Each alternative carries the domestic/international value derived
 * from its own destination country at extraction time, so nothing is inherited
 * and nothing is invented. It was previously cleared on swap, which sounded
 * conservative but made the review form fall back to "Domestic" on a leg to
 * Paris — asserting a value we had actually read the opposite of, and one that
 * picks a shorter bag-drop cutoff.
 */
export async function useTicketAlternativeLeg(form: FormData): Promise<void> {
  const draft = await readDraft();
  const prefill = draft.ticketPrefill;
  const index = Number(str(form, "index"));
  const chosen = prefill?.alternatives?.[index];

  if (!prefill || !chosen) redirect("/book/flight");

  const replaced: PrefillAlternative | null = prefill.departureAirport
    ? {
        departureAirport: prefill.departureAirport,
        ...(prefill.destinationAirport
          ? { destinationAirport: prefill.destinationAirport }
          : {}),
        ...(prefill.flightNumber ? { flightNumber: prefill.flightNumber } : {}),
        ...(prefill.departureAtLocal
          ? { departureAtLocal: prefill.departureAtLocal }
          : {}),
        // Carried so swapping BACK restores this leg's scope too.
        ...(prefill.scope ? { scope: prefill.scope } : {}),
      }
    : null;

  const alternatives = (prefill.alternatives ?? []).filter((_, i) => i !== index);
  if (replaced) alternatives.unshift(replaced);

  await writeDraft({
    ticketPrefill: {
      ...prefill,
      departureAirport: chosen.departureAirport,
      flightNumber: chosen.flightNumber,
      airlineIata: chosen.flightNumber
        ? (/^([A-Z]{2}|[A-Z]\d|\d[A-Z])/.exec(chosen.flightNumber)?.[1] ?? undefined)
        : undefined,
      departureAtLocal: chosen.departureAtLocal,
      destinationAirport: chosen.destinationAirport,
      scope: chosen.scope,
      nonServicedOrigin: undefined,
      // The customer picked this leg, so it is no longer our ambiguous guess.
      selectionReason: "single_serviced_origin",
      alternatives: alternatives.slice(0, 2),
    },
  });

  redirect("/book/flight?from=ticket");
}

/**
 * Confirming the flight review form is the moment funnel state is first
 * persisted server-side: anonymous session + `public.users` row + draft row.
 */
export async function submitFlight(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const draft = await readDraft();

  const zip = str(form, "zip");
  const coverage = checkCoverage(zip);
  if (!coverage.covered) {
    return coverage.reason === "malformed"
      ? { error: "That ZIP code does not look right." }
      : {
          error: "We do not serve that ZIP code yet.",
          outOfCoverageZip: coverage.zip ?? zip,
        };
  }

  const flightNumber = str(form, "flightNumber").toUpperCase().replace(/\s+/g, "");
  const departureAirport = str(form, "departureAirport") as AirportCode;
  const departureAtLocal = str(form, "departureAt");
  const scope = (str(form, "scope") || "domestic") as CutoffScope;
  const paxName = str(form, "paxName");
  /*
   * Where they are flying TO. Optional, display-only, and validated loosely —
   * three letters or nothing.
   *
   * A bad value here costs nothing (it appears on a history card and nowhere
   * else), so it is never a reason to refuse a booking: anything that is not
   * three letters is simply dropped rather than returned as an error the
   * customer has to clear before they can pay.
   */
  const destinationRaw = str(form, "destinationAirport")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const destinationAirport = destinationRaw.length === 3 ? destinationRaw : undefined;

  if (!/^[A-Z0-9]{2,3}\d{1,4}$/.test(flightNumber)) {
    return { error: "Enter a flight number like DL123 or UA1189." };
  }
  if (!AIRPORTS.includes(departureAirport)) {
    return { error: "Choose JFK, LGA, or EWR." };
  }
  if (!departureAtLocal) {
    return { error: "Enter your departure date and time." };
  }

  // A `datetime-local` value carries no zone, so it has to be read in the
  // DEPARTURE AIRPORT's — `new Date(...)` applies the SERVER's instead, which
  // is UTC in production and silently shifted every stored departure (and so
  // every cutoff and bookable window derived from it) by the offset.
  const flightCore = tryGetCore();
  const airportTz = flightCore
    ? await resolveDisplayTz(flightCore.db, departureAirport).catch(
        () => FALLBACK_DISPLAY_TZ,
      )
    : FALLBACK_DISPLAY_TZ;

  let departureAt: Date;
  try {
    departureAt = airportLocalDateTime(departureAtLocal, airportTz);
  } catch {
    return { error: "That departure time is not valid." };
  }
  if (departureAt.getTime() < Date.now()) {
    return { error: "That flight has already departed." };
  }
  if (!paxName) {
    return { error: "Enter the name on the ticket." };
  }

  // Airline code is the leading token of the flight number. IATA codes are
  // two characters (letters, or letter+digit like B6) — only fall back to a
  // 3-char prefix when the 2-char form doesn't parse (e.g. private codes).
  // TODO(aeroapi): validate against AeroAPI once the integration exists.
  const airlineIata =
    /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}$/.exec(flightNumber)?.[1] ??
    /^([A-Z0-9]{2,3})/.exec(flightNumber)?.[1] ??
    "";

  // The one real cross-step dependency: the pickup window was chosen against
  // this flight's bookable band. If the flight changed in any way that moves
  // the band, the selected window (and its lead-time price) is no longer
  // trustworthy — clear it so the funnel routes back through the window step.
  const flightChanged =
    draft.departureAirport !== departureAirport ||
    draft.departureAt !== departureAt.toISOString() ||
    draft.airlineIata !== airlineIata ||
    (draft.scope ?? "domestic") !== scope;

  // The confirm step: only what the user submitted from the review form
  // persists. The raw extraction prefill is cleared here — it never outlives
  // this confirmation and is never read by any booking-write path.
  const next = await writeDraft({
    zip: coverage.zip,
    // The quote and the coverage answer the customer is about to see are
    // built from THIS ZIP. Recorded so the pickup step can tell whether the
    // address they type two steps later is the same place.
    quotedZip: coverage.zip,
    flightNumber,
    airlineIata,
    departureAirport,
    departureAt: departureAt.toISOString(),
    scope,
    paxName,
    destinationAirport,
    ticketPrefill: undefined,
    ...(flightChanged ? { windowStart: undefined, windowEnd: undefined } : {}),
  });

  // First server-side persistence: anonymous session (when available) + the
  // user-owned draft row. Failure degrades to cookie-only state — never blocks.
  // The Turnstile token comes from the field mounted on the flight form;
  // Supabase verifies it during signInAnonymously.
  try {
    await ensureDraftSession(str(form, "turnstileToken") || null);
  } catch (error) {
    console.error("[book] ensureDraftSession failed", error);
  }

  redirect(nextIncompleteStep(next));
}

/* ------------------------------------------------------------------ */
/* Step 2 — pickup (address + bags)                                     */
/* ------------------------------------------------------------------ */

export async function submitPickup(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const draft = await readDraft();
  const line1 = str(form, "line1");
  const line2 = str(form, "line2");
  const city = str(form, "city");
  const state = str(form, "state").toUpperCase();
  const zip = str(form, "zip");
  const bagCount = Number(str(form, "bagCount"));
  // The point behind the address, when a Places suggestion supplied one. The
  // form posts these only while they still belong to the text in the fields —
  // any hand edit drops them — so "absent" here means "fall back to the ZIP
  // centroid", and the draft's old values must go with them.
  const precision = readAddressPrecision(form);

  if (!line1 || !city || !state || !zip) {
    return { error: "Fill in street, city, state, and ZIP." };
  }
  if (!Number.isInteger(bagCount) || bagCount < 1 || bagCount > 10) {
    return { error: "Choose between 1 and 10 bags." };
  }

  const coverage = checkCoverage(zip);
  if (!coverage.covered) {
    return coverage.reason === "malformed"
      ? { error: "That ZIP code does not look right." }
      : {
          error: "We do not serve that ZIP code yet.",
          outOfCoverageZip: coverage.zip ?? zip,
        };
  }

  /*
   * Reconcile the address ZIP with the one the quote was built for.
   *
   * Both ZIPs pass coverage here — that is the point. Two covered ZIPs are
   * still two different places: `zip_centroids` gives each its own
   * coordinate, which is where every drive-time estimate starts, and
   * `agent_zones` maps each to a different agent. Silently taking the new one
   * changed the pickup location, the dispatch zone and (once the Maps seam is
   * real) the price, without the customer being told any of it had happened.
   *
   * The customer decides, in one click: re-quote for the address they typed,
   * or go back and use an address in the ZIP they were quoted for. The button
   * that re-quotes posts `confirmZipChange`, which is why this is one action
   * and not two.
   */
  const quotedZip = draft.quotedZip ?? draft.zip;
  const changingZip = Boolean(quotedZip) && !sameZip(quotedZip!, coverage.zip);
  if (changingZip && str(form, "confirmZipChange") !== "1") {
    return { zipMismatch: { quotedZip: quotedZip!, addressZip: coverage.zip } };
  }

  const next = await writeDraft({
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    state,
    zip: coverage.zip,
    bagCount,
    // Written unconditionally, `undefined` included: a customer who picked a
    // suggestion and then corrected the street by hand must not keep the
    // first address's coordinates.
    lat: precision.lat,
    lng: precision.lng,
    placeId: precision.placeId,
    // Re-quoting means this ZIP is now the one the price is computed for.
    // The chosen window goes with it: its lead-time price and its drive-time
    // headroom were both derived from the old location, the same reason
    // `submitFlight` clears the window when the flight moves.
    ...(changingZip
      ? { quotedZip: coverage.zip, windowStart: undefined, windowEnd: undefined }
      : { quotedZip: quotedZip ?? coverage.zip }),
  });
  await syncDraftRow();

  redirect(nextIncompleteStep(next));
}

/** ZIP+4 and whitespace are the same five-digit ZIP for this comparison. */
function sameZip(a: string, b: string): boolean {
  return a.trim().slice(0, 5) === b.trim().slice(0, 5);
}

/**
 * `lat`/`lng`/`placeId` off the pickup form, or undefined.
 *
 * Both halves of the coordinate or neither: half a point is not a point, and
 * a lone latitude written over a centroid pair would leave the address
 * pointing somewhere nobody chose. Anything unparseable is treated as absent
 * rather than rejected — these are an assist, and a bad value must not stop a
 * customer booking.
 */
function readAddressPrecision(form: FormData): {
  lat: number | undefined;
  lng: number | undefined;
  placeId: string | undefined;
} {
  const lat = Number(str(form, "lat"));
  const lng = Number(str(form, "lng"));
  const placeId = str(form, "placeId");

  const usable =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  return {
    lat: usable ? lat : undefined,
    lng: usable ? lng : undefined,
    placeId: placeId ? placeId.slice(0, 255) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Step 3 — window                                                      */
/* ------------------------------------------------------------------ */

export async function submitSlot(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const windowStartRaw = str(form, "windowStart");
  if (!windowStartRaw) return { error: "Choose a pickup window." };

  const windowStart = new Date(windowStartRaw);
  if (Number.isNaN(windowStart.getTime())) {
    return { error: "That window is not valid. Pick another." };
  }
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);

  const draft = await readDraft();
  const core = tryGetCore();

  // Re-check bookability: the picker may be minutes old, a blackout may have
  // landed, or the notice fence may have moved past this window.
  if (core && draft.departureAirport && draft.departureAt && draft.airlineIata) {
    try {
      const distance = await resolveQuoteDistanceKm(core, {
        airportCode: draft.departureAirport,
        zip: draft.zip,
      });

      const { windows } = await listBookableWindows(core, {
        airportCode: draft.departureAirport,
        airlineIata: draft.airlineIata,
        scope: draft.scope ?? "domestic",
        departureAt: new Date(draft.departureAt),
        bagCount: draft.bagCount ?? 1,
        distanceKm: distance.km,
      });
      if (!windows.some((w) => w.windowStart.getTime() === windowStart.getTime())) {
        return { error: "That window is no longer available. Pick another." };
      }
    } catch {
      // Database unreachable — let createBooking be the authority.
    }
  }

  const next = await writeDraft({
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  });
  await syncDraftRow();
  redirect(nextIncompleteStep(next));
}

/* ------------------------------------------------------------------ */
/* Step 4 — review & pay                                                */
/* ------------------------------------------------------------------ */

/**
 * Creates the booking for the verified session user.
 *
 * All the interesting work — capacity claim, pricing, custody event, payment
 * authorization, rollback — happens inside `createBooking`. This function only
 * assembles the input and maps typed errors to messages.
 */
export async function confirmBooking(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const draft = await readDraft();

  if (!isDraftReadyForPayment(draft)) {
    return { error: "Your booking is incomplete. Start again from the flight step." };
  }

  // The only auth wall in the product sits in front of this action.
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/book/verify");

  let core;
  try {
    core = getCore();
  } catch {
    return {
      error:
        "The database is not configured. Set DATABASE_URL in .env.local (see the README quickstart).",
    };
  }

  try {
    // Shared with the Stripe path's preparePayment — see lib/checkout.ts.
    const { userRow, input } = await buildCheckoutSetup(core, authUser, draft);

    // Email-only customers have no verified phone; the driver still needs a
    // number to reach at the door. Plain text field, no OTP.
    let contactPhone: string | null = null;
    if (!userRow.phone) {
      const rawContact = str(form, "contactPhone");
      contactPhone = rawContact ? toE164UsCa(rawContact) : null;
      if (!contactPhone) {
        return {
          error: "Enter a contact number for the driver on pickup day.",
        };
      }
    }

    // Best-effort, from a hidden field the browser fills in. Metadata only:
    // the booking is still rendered in the AIRPORT's zone for everyone. This
    // is what lets support answer "did they think 10 AM was their time?" and
    // what gates the "times are local to JFK" banner to non-local customers.
    const bookedFromTz = str(form, "bookedFromTz");

    const result = await createBooking(core, { ...input, contactPhone, bookedFromTz });

    // Inline (fake-provider) authorization reaches `paid` with no webhook and
    // no return-page re-check — emit the confirmation event here. No-throw.
    if (result.booking.status === "paid") {
      await emitBookingConfirmed(core, result.booking);
    }

    try {
      await softDeleteBookingDraft(core.db, userRow.id);
    } catch (cleanupError) {
      console.error("[book] draft row cleanup failed", cleanupError);
    }
    await clearDraft();
    redirect(`/book/confirmed?booking=${result.booking.id}`);
  } catch (error: unknown) {
    // `redirect` throws a control-flow signal; let it through.
    if (isRedirectError(error)) throw error;

    if (error instanceof SlotNotSellableError) {
      return {
        error: "That window can no longer be booked for your flight. Pick another.",
      };
    }
    if (error instanceof OutOfCoverageError) {
      return { error: "That address is outside our service area." };
    }
    if (error instanceof QuoteZipMismatchError) {
      // Unreachable through the funnel — the pickup step reconciles the two
      // ZIPs before this action can be reached. It is here because a server
      // action stays a reachable POST whatever the form renders.
      return {
        error: `Your pickup address is in ${error.addressZip} but this booking was priced for ${error.quotedZip}. Go back to the pickup step and confirm the address.`,
      };
    }
    if (error instanceof ConflictError) {
      return { error: error.message };
    }

    console.error("[book] confirmBooking failed", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. No payment was taken.",
    };
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
