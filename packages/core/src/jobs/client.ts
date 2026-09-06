import { Inngest, eventType, staticSchema } from "inngest";

/**
 * Inngest client and event catalogue.
 *
 * Events carry ISO-8601 strings rather than `Date` objects: payloads are
 * serialised to JSON between steps, and a `Date` would silently arrive as a
 * string on the other side. Being explicit removes a whole class of "why is
 * this a string" bug.
 *
 * v4 note: schemas moved from the client (`EventSchemas.fromRecord`) onto
 * per-event `eventType()` definitions. `staticSchema` keeps the v3 semantics —
 * compile-time types only, no runtime validation.
 */

export type KooleeEvents = {
  "booking/confirmed": {
    data: {
      bookingId: string;
      /** ISO-8601. Start of the customer's pickup window. */
      pickupStartAt: string;
      /** ISO-8601. Scheduled flight departure. */
      departureAt: string;
      /** E.164, for the reminder SMS. */
      customerPhone: string;
      customerName?: string;
    };
  };
  "booking/agent_no_show_check": {
    data: {
      bookingId: string;
      /** ISO-8601. Start of the slot the agent was due at. */
      slotStartAt: string;
      assigneeUserId?: string;
    };
  };
  "booking/agent_assigned": {
    data: {
      bookingId: string;
      /** The staff user now responsible for the verification visit. */
      agentUserId: string;
    };
  };
  "booking/bags_sealed": {
    data: {
      bookingId: string;
    };
  };
  "booking/exception_raised": {
    data: {
      bookingId: string;
      reason: string;
      raisedByUserId?: string;
    };
  };
  "booking/driver_selected": {
    data: {
      bookingId: string;
      /** Shift the pickup was assigned to. */
      shiftId: string;
      driverUserId: string;
    };
  };
  "booking/delivered_to_bagdrop": {
    data: {
      bookingId: string;
      /** ISO-8601. When the bags reached the counter. */
      deliveredAt: string;
    };
  };
  "booking/driver_pool_empty": {
    data: {
      bookingId: string;
      /** Pickup ZIP — the first thing ops looks at. */
      zip: string;
      bagCount: number;
    };
  };
};

export const bookingConfirmed = eventType("booking/confirmed", {
  schema: staticSchema<KooleeEvents["booking/confirmed"]["data"]>(),
});

export const agentNoShowCheck = eventType("booking/agent_no_show_check", {
  schema: staticSchema<KooleeEvents["booking/agent_no_show_check"]["data"]>(),
});

/**
 * A verification visit got an owner. Raised from `assignAgentToBooking` — the
 * one write path for both the manual assign and the on-paid auto-assign — so
 * a customer is told who is coming however the assignment happened.
 */
export const agentAssigned = eventType("booking/agent_assigned", {
  schema: staticSchema<KooleeEvents["booking/agent_assigned"]["data"]>(),
});

/**
 * Every bag is weighed, sealed and photographed, and the shortlist just
 * opened. Raised from `applyTransition` on arrival at `verified_sealed`, the
 * same choke point the exception emit uses and for the same reason: a second
 * caller reaching that state tomorrow is covered without being told.
 *
 * Carries only the booking id. The bag count and the seal numbers are read at
 * send time, because an event that carried them would be a snapshot of a
 * booking somebody could still have corrected.
 */
export const bagsSealed = eventType("booking/bags_sealed", {
  schema: staticSchema<KooleeEvents["booking/bags_sealed"]["data"]>(),
});

export const exceptionRaised = eventType("booking/exception_raised", {
  schema: staticSchema<KooleeEvents["booking/exception_raised"]["data"]>(),
});

export const driverSelected = eventType("booking/driver_selected", {
  schema: staticSchema<KooleeEvents["booking/driver_selected"]["data"]>(),
});

export const deliveredToBagdrop = eventType("booking/delivered_to_bagdrop", {
  schema: staticSchema<KooleeEvents["booking/delivered_to_bagdrop"]["data"]>(),
});

/**
 * A sealed booking was shown to a customer and there was nobody to offer.
 *
 * Not an exception — the booking is fine, the roster is not — so it goes
 * through its own event rather than `booking/exception_raised`, which would
 * put a staffing problem in the exceptions queue where it would be resolved
 * by a human who cannot fix it there.
 */
export const driverPoolEmpty = eventType("booking/driver_pool_empty", {
  schema: staticSchema<KooleeEvents["booking/driver_pool_empty"]["data"]>(),
});

/**
 * The event key is optional: the local dev server (`pnpm dev:inngest`) does not
 * need one, which keeps the zero-credentials boot requirement intact.
 *
 * The signing key lives on the client in v4 (it was a `serve()` option in v3)
 * and is only needed against Inngest Cloud.
 */
export interface InngestClientConfig {
  eventKey?: string | undefined;
  signingKey?: string | undefined;
  isDev?: boolean;
}

export function createInngestClient(config: InngestClientConfig = {}) {
  return new Inngest({
    id: "koolee",
    ...(config.eventKey ? { eventKey: config.eventKey } : {}),
    ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    ...(config.isDev === undefined ? {} : { isDev: config.isDev }),
  });
}

export type KooleeInngest = ReturnType<typeof createInngestClient>;
