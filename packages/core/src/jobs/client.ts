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
  "booking/exception_raised": {
    data: {
      bookingId: string;
      reason: string;
      raisedByUserId?: string;
    };
  };
};

export const bookingConfirmed = eventType("booking/confirmed", {
  schema: staticSchema<KooleeEvents["booking/confirmed"]["data"]>(),
});

export const agentNoShowCheck = eventType("booking/agent_no_show_check", {
  schema: staticSchema<KooleeEvents["booking/agent_no_show_check"]["data"]>(),
});

export const exceptionRaised = eventType("booking/exception_raised", {
  schema: staticSchema<KooleeEvents["booking/exception_raised"]["data"]>(),
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
