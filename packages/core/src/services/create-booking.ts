import { and, eq, gt, lt } from "drizzle-orm";
import {
  addresses,
  airlineCutoffs,
  bags,
  bookings,
  custodyEvents,
  payments,
  pricingRules,
  slotBlocks,
  type AirportCode,
  type Booking,
  type CutoffScope,
  type Database,
} from "@koolee/db";

import { transitionOrThrow } from "../booking/state-machine";
import type { CoreConfig } from "../config";
import { assertInCoverage } from "../coverage/nyc-zips";
import {
  NotFoundError,
  PaymentFailedError,
  PricingRuleInvalidError,
  SlotNotSellableError,
} from "../errors";
import type { PaymentAuth } from "../payments/types";
import { price, toPricingRuleInput, type PriceBreakdown } from "../pricing/engine";
import { resolveCutoffMinutes } from "../slots/cutoff";
import { evaluateHourlyWindow, pickupLeadMinutesFor } from "../slots/windows";
import { resolveDisplayTz } from "./display-tz";

/**
 * A browser-reported IANA zone, or null if it is not one.
 *
 * Deliberately permissive about failure: this value is analytics and support
 * context, so a VPN, a hardened browser, or a hand-edited request should cost
 * us the field, never the booking. `Intl` is the authority on whether a zone
 * id is real — a regex would drift from the tz database.
 */
function sanitizeIanaZone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = raw.trim();
  try {
    // Validating a zone id, not rendering a time: Intl throws on an unknown
    // zone, which is exactly the check we want, and no instant is formatted.
    // eslint-disable-next-line no-restricted-syntax
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/**
 * The booking orchestrator.
 *
 * Ordering here is the whole point, so it is worth stating plainly:
 *
 *   1. Validate coverage, resolve the cutoff, confirm the pickup window is
 *      bookable (band, notice, blackouts), and compute the price — all
 *      before anything is written.
 *   2. Open ONE transaction. Inside it: insert the booking, its bags, and
 *      the custody event.
 *   3. Authorize payment AFTER the transaction commits, then record the
 *      payment row. If authorization fails, compensate by cancelling the
 *      booking.
 *
 * Why payment is outside the transaction: a Stripe call takes hundreds of
 * milliseconds, and holding row locks across a third-party network call is
 * how a booking rush turns into a database pile-up. The tradeoff is that a
 * crash between commit and authorization leaves a `draft` booking —
 * recoverable, and far better than the alternative.
 *
 * There is no capacity to claim: pickup windows are virtual and accept
 * unlimited bookings, so two concurrent customers picking the same window
 * both simply succeed.
 */

export interface CreateBookingInput {
  userId: string;
  /** Must already exist and belong to `userId`. */
  pickupAddressId: string;
  /**
   * The clock-aligned one-hour pickup window the customer picked. Validated
   * against the flight's bookable band, the booking notice, and ops
   * blackouts — a window the picker displayed always passes.
   */
  pickupWindowStart: Date;
  pickupWindowEnd: Date;

  flightNumber: string;
  airlineIata: string;
  departureAirport: AirportCode;
  departureAt: Date;
  /** Domestic and international cutoffs differ; the caller must say which. */
  scope: CutoffScope;
  paxName: string;

  bagCount: number;
  /** Door-to-bag-drop distance. Maps is stubbed, so callers estimate. */
  distanceKm: number;
  /** Overrides the configured default when a real estimate exists. */
  driveTimeMinutes?: number;

  promoCode?: string | null;
  isSenior?: boolean;

  /**
   * Pickup-day contact number for customers without a verified phone
   * (email-only sign-up). Plain text, never OTP-verified.
   */
  contactPhone?: string | null;

  /**
   * The customer's OWN IANA zone, from the browser
   * (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
   *
   * Stored as metadata and NEVER used to render this booking — see the
   * `booked_from_tz` column comment. Best-effort by design: an unparseable or
   * absent value is dropped, never an error, because no booking should fail
   * over a browser that lies about where it is.
   */
  bookedFromTz?: string | null;
}

export interface CreateBookingResult {
  booking: Booking;
  breakdown: PriceBreakdown;
  payment: PaymentAuth;
}

export async function createBooking(
  config: CoreConfig,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const { db, payments: paymentProvider, clock, defaults } = config;
  const now = clock.now();

  if (!Number.isInteger(input.bagCount) || input.bagCount < 1) {
    throw new PricingRuleInvalidError(
      `bagCount must be a positive integer, got ${input.bagCount}`,
    );
  }

  /* --- 1. Read-only validation ------------------------------------- */

  const address = await db.query.addresses.findFirst({
    where: eq(addresses.id, input.pickupAddressId),
  });
  if (!address) throw new NotFoundError("Address", input.pickupAddressId);
  if (address.userId !== input.userId) {
    throw new NotFoundError("Address", input.pickupAddressId);
  }
  assertInCoverage(address.zip);

  const cutoffRows = await db
    .select()
    .from(airlineCutoffs)
    .where(eq(airlineCutoffs.airportCode, input.departureAirport));

  const cutoffMinutes = resolveCutoffMinutes(
    cutoffRows,
    {
      airlineIata: input.airlineIata,
      airportCode: input.departureAirport,
      scope: input.scope,
    },
    now,
  );

  // Blackouts that overlap the submitted window at this airport.
  const blocks = await db
    .select()
    .from(slotBlocks)
    .where(
      and(
        eq(slotBlocks.airportCode, input.departureAirport),
        lt(slotBlocks.blockStart, input.pickupWindowEnd),
        gt(slotBlocks.blockEnd, input.pickupWindowStart),
      ),
    );

  const reason = evaluateHourlyWindow(input.pickupWindowStart, input.pickupWindowEnd, {
    departureAt: input.departureAt,
    cutoffMinutes,
    now,
    driveTimeMinutes: input.driveTimeMinutes ?? defaults.driveTimeMinutes,
    bufferMinutes: defaults.bufferMinutes,
    operationsReserveMinutes: defaults.operationsReserveMinutes,
    bandMinutes: defaults.bandMinutes,
    noticeMinutes: defaults.noticeMinutes,
    blocks,
  });
  if (reason !== undefined) {
    throw new SlotNotSellableError(input.pickupWindowStart.toISOString(), reason);
  }

  const rule = await db.query.pricingRules.findFirst({
    where: eq(pricingRules.active, true),
    orderBy: (t, { desc }) => [desc(t.effectiveFrom)],
  });
  if (!rule) {
    throw new PricingRuleInvalidError(
      "No active pricing rule. Run `pnpm seed`, or activate one in the ops console.",
    );
  }

  const breakdown = price({
    rule: toPricingRuleInput(rule),
    bagCount: input.bagCount,
    distanceKm: input.distanceKm,
    pickupLeadMinutes: pickupLeadMinutesFor(input.pickupWindowEnd, input.departureAt),
    discountContext: {
      promoCode: input.promoCode ?? null,
      isSenior: input.isSenior ?? false,
    },
  });

  // The zone every human-facing time on this booking will be read in, resolved
  // once here so the row carries it forever after. See display-tz.ts.
  const displayTz = await resolveDisplayTz(db, input.departureAirport);

  /* --- 2. One transaction: write the booking ------------------------ */

  const created = await db.transaction(async (tx) => {
    const [booking] = await tx
      .insert(bookings)
      .values({
        userId: input.userId,
        status: "draft",
        flightNumber: input.flightNumber.toUpperCase(),
        airlineIata: input.airlineIata.toUpperCase(),
        departureAirport: input.departureAirport,
        departureAt: input.departureAt,
        paxName: input.paxName,
        pickupAddressId: input.pickupAddressId,
        bagCount: input.bagCount,
        pickupWindowStart: input.pickupWindowStart,
        pickupWindowEnd: input.pickupWindowEnd,
        // Snapshotted once, here, and never updated: this is what makes the
        // row self-describing for every app that reads it later.
        displayTz,
        bookedFromTz: sanitizeIanaZone(input.bookedFromTz),
        contactPhone: input.contactPhone ?? null,
        priceCents: breakdown.totalCents,
        currency: defaults.currency,
        // The receipt: which lead-time step, distance, and discounts made
        // this price. Feeds dynamic-pricing analysis with per-window data.
        priceBreakdown: breakdown,
      })
      .returning();

    if (!booking) throw new Error("Insert of booking returned no row");

    // `ordinal` is assigned here, once, and is the bag's identity for the rest
    // of the booking's life — every reader orders by it and every screen labels
    // from it. Do not derive bag numbers from array position anywhere.
    await tx.insert(bags).values(
      Array.from({ length: input.bagCount }, (_, index) => ({
        bookingId: booking.id,
        ordinal: index + 1,
      })),
    );

    // The custody log opens with the booking itself, so the chain starts at
    // creation rather than at the first physical handover.
    await tx.insert(custodyEvents).values({
      bookingId: booking.id,
      actorUserId: input.userId,
      actorRole: "customer",
      eventType: "booking.created",
      metadata: {
        pickupWindowStart: input.pickupWindowStart.toISOString(),
        pickupWindowEnd: input.pickupWindowEnd.toISOString(),
        priceCents: breakdown.totalCents,
        cutoffMinutes,
        bagCount: input.bagCount,
      },
    });

    return booking;
  });

  /* --- 3. Authorize, then record the payment ------------------------ */

  let auth: PaymentAuth;
  try {
    auth = await paymentProvider.authorize(created.id, breakdown.totalCents);
  } catch (error: unknown) {
    await compensateFailedAuthorization(db, created.id);
    throw new PaymentFailedError(
      `Authorization failed for booking ${created.id}; the booking was cancelled.`,
      error,
    );
  }

  const settled = await db.transaction(async (tx) => {
    await tx
      .insert(payments)
      .values({
        bookingId: created.id,
        provider: paymentProvider.name,
        providerRef: auth.authId,
        // requires_action / processing are honestly `pending` — the client
        // still has to confirm (or the outcome is still settling). Only a
        // dead authorization is `failed`.
        status:
          auth.status === "authorized"
            ? "authorized"
            : auth.status === "failed"
              ? "failed"
              : "pending",
        amountCents: auth.amountCents,
      })
      .onConflictDoNothing({
        target: [payments.provider, payments.providerRef],
      });

    if (auth.status !== "authorized") {
      // requires_action: the client still has to confirm. The booking stays a
      // draft until the webhook (or the return page's status re-check) says
      // the funds are held.
      return created;
    }

    const moved = transitionOrThrow(created, {
      event: "authorize_payment",
      actor: { userId: input.userId, role: "customer" },
      metadata: { provider: paymentProvider.name, providerRef: auth.authId },
    });

    const [updated] = await tx
      .update(bookings)
      .set({ status: moved.to })
      .where(and(eq(bookings.id, created.id), eq(bookings.status, moved.from)))
      .returning();

    if (!updated) throw new Error(`Booking ${created.id} changed status concurrently`);

    await tx.insert(custodyEvents).values(moved.custodyEvent);
    return updated;
  });

  // The custody chain is open — customer messaging for it routes through the
  // dispatcher (a logging stub until the notifications work item). Never
  // blocks or fails the booking.
  try {
    await config.dispatcher.send({
      userId: input.userId,
      template: "booking.created",
      data: { bookingId: settled.id, status: settled.status },
      preferredChannel: "sms",
    });
  } catch (error) {
    console.error("[create-booking] notification dispatch failed", error);
  }

  return { booking: settled, breakdown, payment: auth };
}

/**
 * Undoes a committed booking whose payment authorization then failed.
 *
 * Compensating rather than rolling back, because the transaction is already
 * committed by this point. Guarded so a partially applied compensation is
 * safe to retry. (No capacity to release — windows are virtual.)
 */
async function compensateFailedAuthorization(
  db: Database,
  bookingId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const cancelled = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "draft")))
      .returning({ id: bookings.id });

    if (cancelled.length > 0) {
      await tx.insert(custodyEvents).values({
        bookingId,
        eventType: "booking.cancelled",
        metadata: {
          reason: "payment_authorization_failed",
          from: "draft",
          to: "cancelled",
        },
      });
    }
  });
}
