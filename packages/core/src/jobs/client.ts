import { EventSchemas, Inngest } from "inngest";

/**
 * Inngest client and event catalogue.
 *
 * Events carry ISO-8601 strings rather than `Date` objects: payloads are
 * serialised to JSON between steps, and a `Date` would silently arrive as a
 * string on the other side. Being explicit removes a whole class of "why is
 * this a string" bug.
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

/**
 * The event key is optional: the local dev server (`pnpm dev:inngest`) does not
 * need one, which keeps the zero-credentials boot requirement intact.
 */
export interface InngestClientConfig {
  eventKey?: string | undefined;
  isDev?: boolean;
}

export function createInngestClient(config: InngestClientConfig = {}): Inngest<{
  id: "koolee";
  schemas: EventSchemas & { "^": KooleeEvents };
}> {
  return new Inngest({
    id: "koolee",
    schemas: new EventSchemas().fromRecord<KooleeEvents>(),
    ...(config.eventKey ? { eventKey: config.eventKey } : {}),
    ...(config.isDev === undefined ? {} : { isDev: config.isDev }),
  }) as never;
}

export type KooleeInngest = ReturnType<typeof createInngestClient>;
