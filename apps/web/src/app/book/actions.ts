"use server";

import { redirect } from "next/navigation";
import {
  checkCoverage,
  createBooking,
  ensureCustomerWithAddress,
  listSellableSlots,
  OutOfCoverageError,
  SlotNotSellableError,
  SlotSoldOutError,
  type AirportCode,
  type CutoffScope,
} from "@koolee/core";

import { getCore, tryGetCore } from "@/lib/core";
import { clearDraft, readDraft, writeDraft } from "@/lib/booking-draft";

/**
 * Stand-in customer phone until sign-in is wired. Every scaffold booking
 * therefore lands on one customer row, which is obvious in the ops console and
 * hard to mistake for real data.
 */
const PLACEHOLDER_PHONE = "+15550000000";

/**
 * Server actions for the booking flow.
 *
 * Thin adapters: parse the form, call a `@koolee/core` service, translate the
 * typed error into something the form can render. No domain logic lives here.
 */

export interface ActionState {
  error?: string;
  /** Set when the ZIP is outside the service area, to show the email capture. */
  outOfCoverageZip?: string;
  ok?: boolean;
}

const AIRPORTS: AirportCode[] = ["JFK", "LGA", "EWR"];

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ */
/* Step 1 — flight                                                     */
/* ------------------------------------------------------------------ */

export async function submitFlight(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const flightNumber = str(form, "flightNumber").toUpperCase().replace(/\s+/g, "");
  const departureAirport = str(form, "departureAirport") as AirportCode;
  const departureAtLocal = str(form, "departureAt");
  const scope = (str(form, "scope") || "domestic") as CutoffScope;
  const paxName = str(form, "paxName");

  if (!/^[A-Z0-9]{2,3}\d{1,4}$/.test(flightNumber)) {
    return { error: "Enter a flight number like DL123 or UA1189." };
  }
  if (!AIRPORTS.includes(departureAirport)) {
    return { error: "Choose JFK, LGA, or EWR." };
  }
  if (!departureAtLocal) {
    return { error: "Enter your departure date and time." };
  }

  const departureAt = new Date(departureAtLocal);
  if (Number.isNaN(departureAt.getTime())) {
    return { error: "That departure time is not valid." };
  }
  if (departureAt.getTime() < Date.now()) {
    return { error: "That flight has already departed." };
  }
  if (!paxName) {
    return { error: "Enter the name on the ticket." };
  }

  // Airline code is the leading letters/digits of the flight number.
  const airlineIata = /^([A-Z0-9]{2,3})/.exec(flightNumber)?.[1] ?? "";

  await writeDraft({
    flightNumber,
    airlineIata,
    departureAirport,
    departureAt: departureAt.toISOString(),
    scope,
    paxName,
  });

  redirect("/book/address");
}

/* ------------------------------------------------------------------ */
/* Step 2 — address                                                    */
/* ------------------------------------------------------------------ */

export async function submitAddress(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const line1 = str(form, "line1");
  const line2 = str(form, "line2");
  const city = str(form, "city");
  const state = str(form, "state").toUpperCase();
  const zip = str(form, "zip");

  if (!line1 || !city || !state || !zip) {
    return { error: "Fill in street, city, state, and ZIP." };
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

  await writeDraft({
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    state,
    zip: coverage.zip,
  });

  redirect("/book/bags");
}

/** Out-of-area waitlist. Stubbed — nothing is stored yet. */
export async function captureOutOfAreaEmail(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = str(form, "email");
  const zip = str(form, "zip");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Enter a valid email address.", outOfCoverageZip: zip };
  }

  // TODO(waitlist): persist to a `waitlist` table and notify via Resend.
  // Deliberately not stored yet — capturing an address we then drop on the
  // floor is worse than not asking.
  console.log(`[waitlist] ${email} wants coverage in ${zip}`);

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Step 3 — bags                                                       */
/* ------------------------------------------------------------------ */

export async function submitBags(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const bagCount = Number(str(form, "bagCount"));
  if (!Number.isInteger(bagCount) || bagCount < 1 || bagCount > 10) {
    return { error: "Choose between 1 and 10 bags." };
  }

  await writeDraft({ bagCount });
  redirect("/book/slot");
}

/* ------------------------------------------------------------------ */
/* Step 4 — slot                                                       */
/* ------------------------------------------------------------------ */

export async function submitSlot(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const slotId = str(form, "slotId");
  if (!slotId) return { error: "Choose a pickup window." };

  const draft = await readDraft();
  const core = tryGetCore();

  // Re-check sellability: the slot list may be minutes old.
  if (core && draft.departureAirport && draft.departureAt && draft.airlineIata) {
    try {
      const { slots } = await listSellableSlots(core, {
        airportCode: draft.departureAirport,
        airlineIata: draft.airlineIata,
        scope: draft.scope ?? "domestic",
        departureAt: new Date(draft.departureAt),
      });
      if (!slots.some((s) => s.id === slotId)) {
        return { error: "That window is no longer available. Pick another." };
      }
    } catch {
      // Database unreachable — let createBooking be the authority.
    }
  }

  await writeDraft({ slotId });
  redirect("/book/pay");
}

/* ------------------------------------------------------------------ */
/* Step 5 — pay                                                        */
/* ------------------------------------------------------------------ */

/**
 * Creates the booking.
 *
 * All the interesting work — capacity claim, pricing, custody event, payment
 * authorization, rollback — happens inside `createBooking`. This function only
 * assembles the input and maps typed errors to messages.
 */
export async function confirmBooking(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const draft = await readDraft();

  if (
    !draft.flightNumber ||
    !draft.airlineIata ||
    !draft.departureAirport ||
    !draft.departureAt ||
    !draft.paxName ||
    !draft.zip ||
    !draft.line1 ||
    !draft.city ||
    !draft.state ||
    !draft.bagCount ||
    !draft.slotId
  ) {
    return { error: "Your booking is incomplete. Start again from the flight step." };
  }

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
    // TODO(auth): the customer session is not wired into this flow yet — see
    // packages/core/src/auth. Until it is, the customer is identified by the
    // phone entered on the address step, and the row is created on demand.
    const { user, address } = await ensureCustomerWithAddress(core.db, {
      phone: draft.phone ?? PLACEHOLDER_PHONE,
      fullName: draft.paxName,
      line1: draft.line1,
      ...(draft.line2 ? { line2: draft.line2 } : {}),
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
    });

    const result = await createBooking(core, {
      userId: user.id,
      pickupAddressId: address.id,
      slotId: draft.slotId,
      flightNumber: draft.flightNumber,
      airlineIata: draft.airlineIata,
      departureAirport: draft.departureAirport,
      departureAt: new Date(draft.departureAt),
      scope: draft.scope ?? "domestic",
      paxName: draft.paxName,
      bagCount: draft.bagCount,
      // TODO(maps): real door-to-airport distance via the Maps API.
      distanceKm: 20,
      ...(draft.promoCode ? { promoCode: draft.promoCode } : {}),
    });

    await clearDraft();
    redirect(`/book/confirmed?booking=${result.booking.id}`);
  } catch (error: unknown) {
    // `redirect` throws a control-flow signal; let it through.
    if (isRedirectError(error)) throw error;

    if (error instanceof SlotSoldOutError) {
      return { error: "That window sold out. Choose another and we'll try again." };
    }
    if (error instanceof SlotNotSellableError) {
      return {
        error:
          "That window can no longer make your airline's bag-drop cutoff. Choose an earlier one.",
      };
    }
    if (error instanceof OutOfCoverageError) {
      return { error: "That address is outside our service area." };
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
