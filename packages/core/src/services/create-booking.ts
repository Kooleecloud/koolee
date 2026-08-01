import { and, eq, lt, sql } from "drizzle-orm";
import {
  addresses,
  airlineCutoffs,
  bags,
  bookings,
  custodyEvents,
  payments,
  pricingRules,
  slots,
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
  SlotSoldOutError,
} from "../errors";
import type { PaymentAuth } from "../payments/types";
import { price, toPricingRuleInput, type PriceBreakdown } from "../pricing/engine";
import { evaluateSlot, resolveCutoffMinutes, toSellableSlotInput } from "../slots/cutoff";

/**
 * The booking orchestrator.
 *
 * Ordering here is the whole point, so it is worth stating plainly:
 *
 *   1. Validate coverage, resolve the cutoff, confirm the slot is sellable,
 *      and compute the price — all before anything is written.
 *   2. Open ONE transaction. Inside it: claim slot capacity with a conditional
 *      UPDATE, insert the booking, its bags, and the custody event.
 *   3. Authorize payment AFTER the transaction commits, then record the
 *      payment row. If authorization fails, compensate by cancelling the
 *      booking and releasing the slot.
 *
 * Why payment is outside the transaction: a Stripe call takes hundreds of
 * milliseconds, and holding a row lock on `slots` across a third-party network
 * call is how a booking rush turns into a database pile-up. The tradeoff is
 * that a crash between commit and authorization leaves a `draft` booking
 * holding capacity — recoverable, and far better than the alternative.
 *
 * Overselling is prevented by `WHERE booked_count < capacity` on the capacity
 * claim: two concurrent bookings for the last seat produce one winner and one
 * `SlotSoldOutError`, with no phantom slot sold either way.
 */

export interface CreateBookingInput {
  userId: string;
  /** Must already exist and belong to `userId`. */
  pickupAddressId: string;
  slotId: string;

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

  const slot = await db.query.slots.findFirst({ where: eq(slots.id, input.slotId) });
  if (!slot) throw new NotFoundError("Slot", input.slotId);

  const verdict = evaluateSlot(toSellableSlotInput(slot), {
    airportCode: input.departureAirport,
    departureAt: input.departureAt,
    cutoffMinutes,
    driveTimeMinutes: input.driveTimeMinutes ?? defaults.driveTimeMinutes,
    bufferMinutes: defaults.bufferMinutes,
    minimumLeadMinutes: defaults.minimumLeadMinutes,
    now,
  });
  if (!verdict.sellable) {
    throw new SlotNotSellableError(input.slotId, verdict.reason ?? "unknown");
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
    slotTier: slot.tier,
    discountContext: {
      promoCode: input.promoCode ?? null,
      isSenior: input.isSenior ?? false,
    },
  });

  /* --- 2. One transaction: claim capacity + write the booking -------- */

  const created = await db.transaction(async (tx) => {
    // The conditional UPDATE is the concurrency control. Postgres takes a row
    // lock for the duration, so two racing transactions serialise here and
    // exactly one sees a row returned.
    const claimed = await tx
      .update(slots)
      .set({ bookedCount: sql`${slots.bookedCount} + 1` })
      .where(and(eq(slots.id, input.slotId), lt(slots.bookedCount, slots.capacity)))
      .returning({ id: slots.id, bookedCount: slots.bookedCount });

    if (claimed.length === 0) {
      // Throwing rolls the transaction back — nothing was written.
      throw new SlotSoldOutError(input.slotId);
    }

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
        slotId: input.slotId,
        priceCents: breakdown.totalCents,
        currency: defaults.currency,
      })
      .returning();

    if (!booking) throw new Error("Insert of booking returned no row");

    await tx
      .insert(bags)
      .values(Array.from({ length: input.bagCount }, () => ({ bookingId: booking.id })));

    // The custody log opens with the booking itself, so the chain starts at
    // creation rather than at the first physical handover.
    await tx.insert(custodyEvents).values({
      bookingId: booking.id,
      actorUserId: input.userId,
      actorRole: "customer",
      eventType: "booking.created",
      metadata: {
        slotId: input.slotId,
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
    await compensateFailedAuthorization(db, created.id, input.slotId);
    throw new PaymentFailedError(
      `Authorization failed for booking ${created.id}; the booking was cancelled and the slot released.`,
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
        status: auth.status === "authorized" ? "authorized" : "failed",
        amountCents: auth.amountCents,
      })
      .onConflictDoNothing({
        target: [payments.provider, payments.providerRef],
      });

    if (auth.status !== "authorized") {
      // requires_action: the client still has to confirm. The booking stays a
      // draft until the webhook says the funds are held.
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

  return { booking: settled, breakdown, payment: auth };
}

/**
 * Undoes a committed booking whose payment authorization then failed.
 *
 * Compensating rather than rolling back, because the transaction is already
 * committed by this point. Both statements are guarded so a partially applied
 * compensation is safe to retry.
 */
async function compensateFailedAuthorization(
  db: Database,
  bookingId: string,
  slotId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const cancelled = await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "draft")))
      .returning({ id: bookings.id });

    // Only release capacity if this call is the one that cancelled it.
    if (cancelled.length > 0) {
      await tx
        .update(slots)
        .set({ bookedCount: sql`greatest(${slots.bookedCount} - 1, 0)` })
        .where(eq(slots.id, slotId));

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
