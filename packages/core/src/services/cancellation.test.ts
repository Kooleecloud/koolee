import { describe, expect, it } from "vitest";

import { cancellationFromTimeline } from "./cancellation";
import { EVENT_TYPES } from "../booking/state-machine";

/**
 * Reading "who cancelled this" back off the append-only trail.
 *
 * A claim about one row's shape, so it is proved without a database. The
 * gates around WRITING the cancellation live in
 * `cancellation.integration.test.ts`, because they need real payments.
 *
 * Why this matters enough to test at all: the three surfaces that render it —
 * the customer's trip page, the agent's task detail, the console's booking
 * detail — must agree on the answer, and the fact they agree on comes from
 * this function. "Cancelled by you" and "Cancelled by Koolee" are different
 * sentences to the person reading them, and getting them the wrong way round
 * tells a customer Koolee called off a trip they cancelled themselves.
 */

const AT = new Date("2026-09-01T10:00:00Z");

function event(over: Record<string, unknown> = {}) {
  return {
    eventType: EVENT_TYPES.cancel,
    actorRole: "customer" as const,
    createdAt: AT,
    metadata: null,
    ...over,
  };
}

describe("cancellationFromTimeline", () => {
  it("returns null for a booking that was never cancelled", () => {
    expect(
      cancellationFromTimeline([
        event({ eventType: EVENT_TYPES.authorize_payment }),
        event({ eventType: EVENT_TYPES.assign_agent }),
      ]),
    ).toBeNull();
  });

  it("names the customer when the customer cancelled", () => {
    const record = cancellationFromTimeline([event({ actorRole: "customer" })]);
    expect(record).toEqual({ at: AT, by: "customer", reason: null });
  });

  it.each(["admin", "agent", "driver"] as const)(
    "names Koolee when a %s cancelled",
    (role) => {
      expect(cancellationFromTimeline([event({ actorRole: role })])?.by).toBe("staff");
    },
  );

  /*
   * An admin cancelling their OWN personal booking is still Koolee cancelling
   * it. `by` reads the actor's role rather than comparing the actor to the
   * booking's owner, precisely so this case reads the way the customer would
   * describe it.
   */
  it("names Koolee for a staff role even where the actor could be the owner", () => {
    expect(cancellationFromTimeline([event({ actorRole: "admin" })])?.by).toBe("staff");
  });

  it("says system when no actor was recorded", () => {
    expect(cancellationFromTimeline([event({ actorRole: null })])?.by).toBe("system");
  });

  it("carries the reason when the transition recorded one", () => {
    const record = cancellationFromTimeline([
      event({ metadata: { reason: "Trip called off." } }),
    ]);
    expect(record?.reason).toBe("Trip called off.");
  });

  it("tolerates metadata that is absent, empty, or the wrong shape", () => {
    for (const metadata of [null, {}, { reason: 42 }, { source: "admin" }, "nope"]) {
      expect(cancellationFromTimeline([event({ metadata })])?.reason).toBeNull();
    }
  });

  /*
   * `custody_events` is append-only and a booking reaches `cancelled` exactly
   * once, so a trail can only carry one of these. If one ever did carry two,
   * taking the first in a timeline ordered ascending by `createdAt` is taking
   * the cancellation rather than a later correction — and a compensating
   * event is not a second cancellation.
   */
  it("takes the cancellation out of a full timeline regardless of position", () => {
    const record = cancellationFromTimeline([
      event({ eventType: EVENT_TYPES.authorize_payment, actorRole: null }),
      event({ eventType: EVENT_TYPES.assign_agent, actorRole: "admin" }),
      event({ actorRole: "customer" }),
    ]);
    expect(record?.by).toBe("customer");
  });
});
