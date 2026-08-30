import "server-only";

import {
  attachTicketUploadsToUser,
  ensureAddress,
  ensureCustomerFromAuth,
  getCustomerById,
  resolveQuoteDistanceKm,
  toCoordinates,
  type CoreConfig,
  type CreateBookingInput,
} from "@koolee/core";

import type { AuthUser } from "@/lib/auth";
import type { TypedBookingDraft } from "@/lib/booking-draft-schema";

/**
 * The payment gate's shared setup, used by BOTH checkout paths — the fake
 * provider's one-click `confirmBooking` and the Stripe path's
 * `preparePayment`. One implementation so the two can never drift on what a
 * booking is made of:
 *
 *  1. resolve (or create) the customer row for the verified session;
 *  2. attach guest ticket uploads to the user — the payment gate is where
 *     guest artifacts gain an owner (idempotent; failure never blocks);
 *  3. ensure the pickup address row;
 *  4. assemble the `CreateBookingInput`, minus `contactPhone`, which each
 *     path collects at a different moment.
 */

export interface CheckoutSetup {
  userRow: NonNullable<Awaited<ReturnType<typeof getCustomerById>>>;
  input: Omit<CreateBookingInput, "contactPhone">;
}

/** A draft that passed `isDraftReadyForPayment` — fields are present. */
export type PayableDraft = TypedBookingDraft &
  Required<
    Pick<
      TypedBookingDraft,
      | "flightNumber"
      | "airlineIata"
      | "departureAirport"
      | "departureAt"
      | "paxName"
      | "zip"
      | "line1"
      | "city"
      | "state"
      | "bagCount"
      | "windowStart"
      | "windowEnd"
    >
  >;

export function isDraftReadyForPayment(
  draft: TypedBookingDraft,
): draft is PayableDraft {
  return Boolean(
    draft.flightNumber &&
      draft.airlineIata &&
      draft.departureAirport &&
      draft.departureAt &&
      draft.paxName &&
      draft.zip &&
      draft.line1 &&
      draft.city &&
      draft.state &&
      draft.bagCount &&
      draft.windowStart &&
      draft.windowEnd,
  );
}

export async function buildCheckoutSetup(
  core: CoreConfig,
  authUser: AuthUser,
  draft: PayableDraft,
): Promise<CheckoutSetup> {
  const userRow =
    (await getCustomerById(core.db, authUser.id)) ??
    (await ensureCustomerFromAuth(core.db, {
      authUserId: authUser.id,
      isAnonymous: false,
      phone: authUser.phone,
      email: authUser.email,
    }));

  // The payment gate is where guest artifacts gain an owner: ticket uploads
  // made pre-auth were keyed to the cookie draft id.
  if (draft.draftId) {
    try {
      await attachTicketUploadsToUser(core.db, {
        draftId: draft.draftId,
        userId: userRow.id,
      });
    } catch (attachError) {
      console.error("[checkout] ticket upload attach failed", attachError);
    }
  }

  const address = await ensureAddress(core.db, userRow.id, {
    line1: draft.line1,
    ...(draft.line2 ? { line2: draft.line2 } : {}),
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
  });

  // The price the booking is actually written with. It has to be the same
  // number the review page showed, which is why this asks the same resolver
  // rather than carrying a value forward on the draft: the address row is the
  // authority on where the pickup is, and it exists by this line.
  const distance = await resolveQuoteDistanceKm(core, {
    airportCode: draft.departureAirport,
    zip: draft.zip,
    pickup: toCoordinates(address.lat, address.lng),
  });

  return {
    userRow,
    input: {
      userId: userRow.id,
      pickupAddressId: address.id,
      // The ZIP the price on screen was computed for. `quotedZip` falls back
      // to `zip` for a draft cookie minted before the field existed, where
      // the two were by construction the same value.
      quotedZip: draft.quotedZip ?? draft.zip,
      pickupWindowStart: new Date(draft.windowStart),
      pickupWindowEnd: new Date(draft.windowEnd),
      flightNumber: draft.flightNumber,
      airlineIata: draft.airlineIata,
      departureAirport: draft.departureAirport,
      departureAt: new Date(draft.departureAt),
      scope: draft.scope ?? "domestic",
      paxName: draft.paxName,
      bagCount: draft.bagCount,
      distanceKm: distance.km,
      ...(draft.promoCode ? { promoCode: draft.promoCode } : {}),
    },
  };
}
