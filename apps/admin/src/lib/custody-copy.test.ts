import { describe, expect, it } from "vitest";
import type { CustodyEvent } from "@koolee/core";

import { describeCustodyEvent } from "./custody-copy";

/**
 * The point of these: a custody row must never become LESS informative by
 * being humanized. Every fact in `metadata` either lands in a sentence, lands
 * in the detail list, or is a nested shape the caller shows as raw JSON —
 * nothing is silently dropped.
 */

const event = (over: Partial<CustodyEvent>): CustodyEvent =>
  ({
    id: "evt-1",
    bookingId: "bkg-1",
    bagId: null,
    actorUserId: null,
    actorRole: null,
    eventType: "booking.created",
    lat: null,
    lng: null,
    photoUrl: null,
    metadata: null,
    createdAt: new Date("2026-08-09T12:00:00.000Z"),
    ...over,
  }) as CustodyEvent;

const NY = "America/New_York";

describe("describeCustodyEvent", () => {
  it("writes a sentence, not an event token", () => {
    const { headline } = describeCustodyEvent(event({ eventType: "visit.arrived" }), NY);
    expect(headline).toBe("Agent arrived at the pickup address.");
  });

  it("pulls seal and weight out of a bag.sealed row", () => {
    const { headline, details } = describeCustodyEvent(
      event({
        eventType: "bag.sealed",
        metadata: { taskId: "t-1", sealId: "KL-88213", weightKg: 12.4 },
      }),
      NY,
      );
    expect(headline).toBe("Bag sealed.");
    expect(details).toEqual(["seal KL-88213", "12.4 kg"]);
  });

  it("formats money from cents", () => {
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.payment_captured",
        metadata: { provider: "stripe", amountCents: 8900, captureRef: "pi_123" },
      }),
      NY,
      );
    expect(details).toEqual(["$89.00", "via stripe", "ref pi_123"]);
  });

  it("humanizes snake_case reasons and keeps free-text notes verbatim", () => {
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.exception_raised",
        metadata: { reason: "customer_not_home", note: "Buzzer broken; no answer." },
      }),
      NY,
      );
    expect(details).toEqual([
      "reason: customer not home",
      "note: Buzzer broken; no answer.",
    ]);
  });

  it("names the ops console when the write came from a manual override", () => {
    const { headline } = describeCustodyEvent(
      event({
        eventType: "booking.in_transit",
        metadata: { source: "admin_manual_override", note: "driver confirmed by phone" },
      }),
      NY,
      );
    expect(headline).toContain("Applied as a manual override from the ops console.");
  });

  it("leaves an operator's typed reason exactly as written", () => {
    // Found live: an exception resolution mentioning STRIPE_SECRET_KEY came
    // out as "STRIPE SECRET KEY". Never rewrite what a human recorded.
    const typed =
      "capture failed because the agent app had no STRIPE_SECRET_KEY; resuming transit.";
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.exception_resolved_resumed",
        metadata: { source: "admin_exception_resolution", reason: typed },
      }),
      NY,
      );
    expect(details).toContain(`reason: ${typed}`);
  });

  it("still unmangles a machine enum reason", () => {
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.exception_raised",
        metadata: { reason: "payment_capture_failed" },
      }),
      NY,
      );
    expect(details).toContain("reason: payment capture failed");
  });

  it("collapses the state machine's from/to/event stamp into one arrow", () => {
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.payment_authorized",
        metadata: {
          from: "draft",
          to: "paid",
          event: "authorize_payment",
          provider: "fake",
          providerRef: "auth_000002",
        },
      }),
      NY,
      );
    expect(details).toEqual(["via fake", "ref auth_000002", "draft → paid"]);
    // The three transition keys must not also appear as leftovers.
    expect(details.join(" ")).not.toMatch(/Event:|From:|To:/);
  });

  it("renders an unknown event type readably instead of as a dotted token", () => {
    const { headline } = describeCustodyEvent(
      event({ eventType: "visit.bag_refused" }),
    NY,
    );
    expect(headline).toBe("Visit bag refused.");
  });

  it("still surfaces metadata keys it has no phrasing for", () => {
    const { details } = describeCustodyEvent(
      event({ eventType: "booking.created", metadata: { cutoffMinutes: 90 } }),
    NY,
    );
    expect(details).toContain("Cutoff minutes: 90");
  });

  it("leaves nested shapes to the raw-data disclosure", () => {
    const { details } = describeCustodyEvent(
      event({
        eventType: "booking.created",
        metadata: { bagCount: 2, breakdown: { totalCents: 8900 } },
      }),
      NY,
      );
    expect(details).toEqual(["2 bags"]);
  });

  it("omits facts that are absent rather than guessing them", () => {
    const { headline, details } = describeCustodyEvent(
      event({ eventType: "booking.created", metadata: {} }),
    NY,
    );
    expect(headline).toBe("Booking created.");
    expect(details).toEqual([]);
  });
});
