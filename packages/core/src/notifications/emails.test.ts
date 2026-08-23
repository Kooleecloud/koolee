import { describe, expect, it } from "vitest";

import {
  buildBookingConfirmationEmail,
  buildOpsExceptionEmail,
  buildPickupReminderEmail,
  centsToUsd,
} from "./emails";

/**
 * The copy rules are HARD constraints (PROJECT-STATUS §7), so they get pinned
 * here: the service delivers to the airline's bag drop and never claims to
 * check anyone in; Tag Orange appears only on the CTA.
 */

const ORANGE = "#FF6B35";

const confirmation = () =>
  buildBookingConfirmationEmail({
    to: "casey@example.com",
    paxName: "Casey Rivera",
    flightNumber: "DL123",
    departureAirport: "JFK",
    windowLabel: "Thu 12 Jun, 10:00 AM – 11:00 AM EDT",
    departureLabel: "Thu 12 Jun, 6:00 PM EDT",
    addressLine: "1 Test St, New York, NY 10001",
    bagCount: 2,
    priceLines: [
      { label: "Base fee", amountCents: 2900 },
      { label: "Bags", amountCents: 3000 },
    ],
    totalCents: 5900,
    tripUrl: "https://koolee.test/trips/abc",
  });

describe("transactional email copy rules", () => {
  const messages = () => [
    confirmation(),
    buildPickupReminderEmail({
      to: "casey@example.com",
      paxName: "Casey Rivera",
      windowLabel: "Thu 12 Jun, 10:00 AM – 11:00 AM EDT",
      bagCount: 2,
      tripUrl: "https://koolee.test/trips/abc",
    }),
    buildOpsExceptionEmail({
      to: "ops@koolee.test",
      bookingId: "abc",
      reason: "payment authorization expired",
    }),
  ];

  it("never claims airline check-in, in text or html", () => {
    for (const message of messages()) {
      for (const content of [message.body, message.html ?? ""]) {
        expect(content.toLowerCase()).not.toMatch(/check[- ]?(you |them )?in/);
      }
    }
  });

  it("customer-facing messages say bags go to the airline's bag drop", () => {
    const [confirm, reminder] = messages();
    expect(confirm!.body).toContain("airline's bag drop");
    expect(reminder!.body).toContain("airline's bag drop");
  });

  it("always carries a plain-text body alongside html", () => {
    for (const message of messages()) {
      expect(message.body.length).toBeGreaterThan(40);
      expect(message.html).toBeTruthy();
    }
  });
});

describe("brand color rules", () => {
  it("uses Tag Orange exactly once — on the CTA — when a trip link exists", () => {
    const { html } = confirmation();
    const occurrences = html!.split(ORANGE).length - 1;
    expect(occurrences).toBe(1);
    const ctaIndex = html!.indexOf("<a href=");
    expect(html!.indexOf(ORANGE)).toBeGreaterThan(ctaIndex);
  });

  it("has NO orange anywhere when there is no CTA", () => {
    const { html } = buildOpsExceptionEmail({
      to: "ops@koolee.test",
      bookingId: "abc",
      reason: "x",
    });
    expect(html).not.toContain(ORANGE);
  });
});

describe("confirmation content", () => {
  it("carries window, departure, address, bags, and the full price breakdown", () => {
    const { body } = confirmation();
    expect(body).toContain("Thu 12 Jun, 10:00 AM – 11:00 AM EDT");
    expect(body).toContain("Thu 12 Jun, 6:00 PM EDT");
    expect(body).toContain("1 Test St, New York, NY 10001");
    expect(body).toContain("2 bags");
    expect(body).toContain("Base fee: $29.00");
    expect(body).toContain("Total: $59.00");
    expect(body).toContain("https://koolee.test/trips/abc");
  });

  it("escapes html in interpolated values", () => {
    const { html } = buildBookingConfirmationEmail({
      to: "x@example.com",
      paxName: '<img src=x onerror=alert(1)>"Casey"',
      flightNumber: "DL123",
      departureAirport: "JFK",
      windowLabel: "w",
      departureLabel: "d",
      addressLine: "a",
      bagCount: 1,
      priceLines: [],
      totalCents: 0,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("formats cents as dollars", () => {
    expect(centsToUsd(5900)).toBe("$59.00");
    expect(centsToUsd(5)).toBe("$0.05");
  });
});
