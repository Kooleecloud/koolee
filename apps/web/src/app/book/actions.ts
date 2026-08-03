"use server";

import { redirect } from "next/navigation";
import {
  checkCoverage,
  ConflictError,
  createBooking,
  deleteBookingDraft,
  ensureAddress,
  ensureCustomerFromAuth,
  getCustomerById,
  listSellableSlots,
  OutOfCoverageError,
  parseTicketText,
  SlotNotSellableError,
  SlotSoldOutError,
  type AirportCode,
  type CutoffScope,
} from "@koolee/core";

import { ensureDraftSession } from "@/actions/auth";
import { getAuthUser } from "@/lib/auth";
import { clearDraft, readDraft, writeDraft } from "@/lib/booking-draft";
import { getCore, tryGetCore } from "@/lib/core";
import { syncDraftRow } from "@/lib/draft-sync";
import { extractPdfText, MAX_TICKET_PDF_BYTES } from "@/lib/pdf";
import { toE164UsCa } from "@/lib/phone";

/**
 * Server actions for the booking flow.
 *
 * Thin adapters: parse the form, call a `@koolee/core` service, translate the
 * typed error into something the form can render. No domain logic lives here.
 *
 * Funnel order: ZIP → flight (or ticket PDF → review) → address → bags →
 * slot → price → verify (the only auth gate) → pay.
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
/* Step 1 — ZIP coverage                                                */
/* ------------------------------------------------------------------ */

export async function submitZip(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
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

  await writeDraft({ zip: coverage.zip });
  redirect("/book/flight");
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
/* Step 2 — flight (manual entry, or ticket PDF → editable review)      */
/* ------------------------------------------------------------------ */

/**
 * Ticket PDF upload. Extraction ONLY prefills the flight form — the customer
 * always reviews and confirms before anything is persisted server-side.
 * Never auto-books from raw extraction.
 */
export async function extractTicket(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const file = form.get("ticket");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a PDF e-ticket to upload." };
  }
  if (file.size > MAX_TICKET_PDF_BYTES) {
    return { error: "That file is too large — e-tickets are usually under 5 MB." };
  }
  if (file.type && file.type !== "application/pdf") {
    return { error: "Upload a PDF — that's the format airlines email you." };
  }

  let text: string;
  try {
    text = await extractPdfText(await file.arrayBuffer());
  } catch {
    return { error: "We couldn't read that PDF. Enter your flight below instead." };
  }

  const parsed = parseTicketText(text);
  if (!parsed.flightNumber && !parsed.departureAtLocal && !parsed.paxName) {
    return {
      error:
        "We couldn't find flight details in that PDF. Enter your flight below instead.",
    };
  }

  const departureAtIso = parsed.departureAtLocal
    ? toIsoIfValid(parsed.departureAtLocal)
    : undefined;

  await writeDraft({
    ...(parsed.flightNumber ? { flightNumber: parsed.flightNumber } : {}),
    ...(parsed.airlineIata ? { airlineIata: parsed.airlineIata } : {}),
    ...(parsed.departureAirport ? { departureAirport: parsed.departureAirport } : {}),
    ...(departureAtIso ? { departureAt: departureAtIso } : {}),
    ...(parsed.paxName ? { paxName: parsed.paxName } : {}),
    ...(parsed.scope ? { scope: parsed.scope } : {}),
  });

  redirect("/book/flight?from=ticket");
}

function toIsoIfValid(local: string): string | undefined {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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
  if (!draft.zip) redirect("/book/zip");

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

  // Airline code is the leading token of the flight number. IATA codes are
  // two characters (letters, or letter+digit like B6) — only fall back to a
  // 3-char prefix when the 2-char form doesn't parse (e.g. private codes).
  // TODO(aeroapi): validate against AeroAPI once the integration exists.
  const airlineIata =
    /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}$/.exec(flightNumber)?.[1] ??
    /^([A-Z0-9]{2,3})/.exec(flightNumber)?.[1] ??
    "";

  await writeDraft({
    flightNumber,
    airlineIata,
    departureAirport,
    departureAt: departureAt.toISOString(),
    scope,
    paxName,
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

  redirect("/book/address");
}

/* ------------------------------------------------------------------ */
/* Step 3 — address                                                     */
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
  await syncDraftRow();

  redirect("/book/bags");
}

/* ------------------------------------------------------------------ */
/* Step 4 — bags                                                        */
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
  await syncDraftRow();
  redirect("/book/slot");
}

/* ------------------------------------------------------------------ */
/* Step 5 — slot                                                        */
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
  await syncDraftRow();
  redirect("/book/price");
}

/* ------------------------------------------------------------------ */
/* Step 7 — pay                                                         */
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
    return { error: "Your booking is incomplete. Start again from the ZIP step." };
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
    const userRow =
      (await getCustomerById(core.db, authUser.id)) ??
      (await ensureCustomerFromAuth(core.db, {
        authUserId: authUser.id,
        isAnonymous: false,
        phone: authUser.phone,
        email: authUser.email,
      }));

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

    const address = await ensureAddress(core.db, userRow.id, {
      line1: draft.line1,
      ...(draft.line2 ? { line2: draft.line2 } : {}),
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
    });

    const result = await createBooking(core, {
      userId: userRow.id,
      pickupAddressId: address.id,
      slotId: draft.slotId,
      flightNumber: draft.flightNumber,
      airlineIata: draft.airlineIata,
      departureAirport: draft.departureAirport,
      departureAt: new Date(draft.departureAt),
      scope: draft.scope ?? "domestic",
      paxName: draft.paxName,
      bagCount: draft.bagCount,
      contactPhone,
      // TODO(maps): real door-to-airport distance via the Maps API.
      distanceKm: 20,
      ...(draft.promoCode ? { promoCode: draft.promoCode } : {}),
    });

    try {
      await deleteBookingDraft(core.db, userRow.id);
    } catch (cleanupError) {
      console.error("[book] draft row cleanup failed", cleanupError);
    }
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
