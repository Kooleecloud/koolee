import { describe, expect, it } from "vitest";

import {
  buildAgentAssignedEmail,
  buildBagsSealedEmail,
  buildBookingConfirmationEmail,
  buildCustomerExceptionEmail,
  buildOpsExceptionEmail,
  buildPickupReminderEmail,
  buildZoneOpenedEmail,
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
    bookingRef: "KOO-7H2QM",
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

const agentAssigned = () =>
  buildAgentAssignedEmail({
    to: "casey@example.com",
    bookingRef: "KOO-7H2QM",
    paxName: "Casey Rivera",
    agentGivenName: "Nina",
    windowLabel: "Thu 12 Jun, 10:00 AM – 11:00 AM EDT",
    tripUrl: "https://koolee.test/trips/abc",
  });

const bagsSealed = () =>
  buildBagsSealedEmail({
    to: "casey@example.com",
    bookingRef: "KOO-7H2QM",
    paxName: "Casey Rivera",
    bagCount: 2,
    sealIds: ["KLS-00041", "KLS-00042"],
    tripUrl: "https://koolee.test/trips/abc",
  });

const customerException = () =>
  buildCustomerExceptionEmail({
    to: "casey@example.com",
    bookingRef: "KOO-7H2QM",
    paxName: "Casey Rivera",
    supportEmail: "info@koolee.cloud",
    tripUrl: "https://koolee.test/trips/abc",
  });

describe("transactional email copy rules", () => {
  const messages = () => [
    confirmation(),
    buildPickupReminderEmail({
      to: "casey@example.com",
      bookingRef: "KOO-7H2QM",
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
    buildZoneOpenedEmail({
      to: "casey@example.com",
      zip: "10701",
      bookUrl: "https://koolee.test/book",
    }),
    agentAssigned(),
    bagsSealed(),
    customerException(),
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

  /**
   * The agreement is a gate: an agent cannot collect bags until the customer
   * accepts. The customer therefore has to be TOLD, in the two messages they
   * actually read, or the first they hear of it is an agent standing at their
   * door unable to proceed.
   */
  it("the confirmation and the reminder both ask the customer to accept the agreement", () => {
    const [confirm, reminder] = messages();
    for (const message of [confirm!, reminder!]) {
      for (const content of [message.body, message.html ?? ""]) {
        expect(content).toMatch(/booking agreement/i);
        expect(content).toMatch(/trip page/i);
      }
    }
  });

  it("presents the passport pre-upload as optional, never as a requirement", () => {
    const [confirm] = messages();
    // The word that keeps this from reading as a second gate.
    expect(confirm!.body).toMatch(/optional/i);
    expect(confirm!.body).toMatch(/passport/i);
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

  it("zone-opened email keeps the same rule — one orange, on the CTA", () => {
    const { html, body } = buildZoneOpenedEmail({
      to: "casey@example.com",
      zip: "10701",
      bookUrl: "https://koolee.test/book",
    });
    expect(html!.split(ORANGE).length - 1).toBe(1);
    expect(body).toContain("10701");
    expect(body).toContain("airline's bag drop");
    expect(body).toContain("only waitlist email");
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
    expect(body).toContain("Booking reference: KOO-7H2QM");
  });

  it("escapes html in interpolated values", () => {
    const { html } = buildBookingConfirmationEmail({
      to: "x@example.com",
      bookingRef: "KOO-7H2QM",
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

/* ------------------------------------------------------------------ */
/* The F2 additions                                                     */
/* ------------------------------------------------------------------ */

describe("agent-assigned email", () => {
  it("names the agent and repeats the window in the booking's zone", () => {
    const { subject, body, html } = agentAssigned();
    expect(subject).toBe("Nina is on your pickup — KOO-7H2QM");
    expect(body).toContain("Nina will be collecting your bags.");
    // Preformatted upstream with the zone abbreviation — this asserts it is
    // carried through rather than reformatted anywhere in here.
    expect(body).toContain("Thu 12 Jun, 10:00 AM – 11:00 AM EDT");
    expect(html).toContain("EDT");
  });

  it("falls back to a role, never to an empty name", () => {
    const { subject, body } = buildAgentAssignedEmail({
      to: "casey@example.com",
      bookingRef: "KOO-7H2QM",
      paxName: "Casey Rivera",
      agentGivenName: null,
      windowLabel: "Thu 12 Jun, 10:00 AM – 11:00 AM EDT",
    });
    expect(subject).toContain("Your Koolee agent");
    expect(body).not.toMatch(/^\s*will be collecting/m);
  });

  it("points at the trip page for the photo instead of embedding one", () => {
    // An avatar is a signed URL into a private bucket with an hour's TTL. An
    // <img> in an email read tomorrow is a broken image, so the page is where
    // the face lives.
    const { html, body } = agentAssigned();
    expect(html).not.toMatch(/<img/);
    expect(body).toMatch(/photo is on your trip page/i);
  });

  it("still asks for the agreement — it is the gate at the door", () => {
    expect(agentAssigned().body).toMatch(/booking agreement/i);
  });
});

describe("bags-sealed email", () => {
  it("carries the seal numbers, in bag order", () => {
    const { body } = bagsSealed();
    expect(body).toContain("Bag 1: KLS-00041");
    expect(body).toContain("Bag 2: KLS-00042");
  });

  it("is also the driver prompt — one email, not two seconds apart", () => {
    const { subject, body, html } = bagsSealed();
    expect(subject).toBe("Bags sealed — choose your driver — KOO-7H2QM");
    expect(body).toMatch(/choose your driver/i);
    expect(html).toContain("Choose your driver");
  });

  it("omits the seal block entirely rather than inventing one", () => {
    const { body } = buildBagsSealedEmail({
      to: "casey@example.com",
      bookingRef: "KOO-7H2QM",
      paxName: "Casey Rivera",
      bagCount: 0,
      sealIds: [],
    });
    expect(body).not.toContain("Seal numbers");
    expect(body).not.toContain("Bag 1:");
  });

  it("agrees with itself on singular and plural", () => {
    const one = buildBagsSealedEmail({
      to: "c@example.com",
      bookingRef: "KOO-1",
      paxName: "C",
      bagCount: 1,
      sealIds: ["KLS-1"],
    });
    expect(one.body).toContain("1 bag is weighed");
    expect(bagsSealed().body).toContain("2 bags are weighed");
  });
});

describe("customer exception email", () => {
  it("says a human is on it and nothing about why", () => {
    const { subject, body } = customerException();
    expect(subject).toBe("We're on it — KOO-7H2QM");
    expect(body).toContain("our team is on it");
    expect(body).toContain("info@koolee.cloud");
  });

  it("never leaks an internal reason — the ops email is where those live", () => {
    // The two emails are built from the SAME event. This is the assertion
    // that keeps an operator's words out of a customer's inbox.
    const internal = [
      "ID mismatch",
      "customer not home",
      "payment authorization expired",
      "Airline bag-drop cutoff passed",
      "exception",
      "failed",
    ];
    const { body, html } = customerException();
    for (const phrase of internal) {
      expect(body.toLowerCase()).not.toContain(phrase.toLowerCase());
      expect((html ?? "").toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("asks the customer to do nothing, because there is nothing to do", () => {
    expect(customerException().body).toMatch(/don't need to do anything/i);
  });
});
