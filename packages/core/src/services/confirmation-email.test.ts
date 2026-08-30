import { describe, expect, it } from "vitest";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { fakeDb, type FakeTables } from "../jobs/test-doubles";
import { RecordingNotifier } from "../notifications/notifier";
import { FakePaymentProvider } from "../payments/fake";
import { sendBookingConfirmationEmail } from "./confirmation-email";

/**
 * F3 Phase 0 — the confirmation email has ONE builder and two dispatch points.
 *
 * Before this slice the guest-adds-email-after-payment path hand-rolled its
 * own plain-text body carrying `Track your pickup: /trips/<id>` — a relative
 * path, which in an inbox is not a link at all. Whoever paid as a guest got a
 * materially worse email than a signed-in customer and nothing in the type
 * system or the tests said so.
 *
 * These pin the two things a future refactor could quietly undo: that this
 * path renders the branded template (`buildBookingConfirmationEmail`), and
 * that the trip link is ABSOLUTE.
 *
 * The Inngest side of the same assembler is covered in jobs/functions.test.ts.
 */

const NOW = new Date("2026-09-01T12:00:00Z");
const PICKUP_START = new Date("2026-09-03T14:00:00Z");
const DEPARTURE = new Date("2026-09-03T22:00:00Z");

const seed = (overrides: FakeTables = {}): FakeTables => ({
  bookings: [
    {
      id: "b-1",
      ref: "KOO-7H2QM",
      userId: "u-1",
      status: "paid",
      paxName: "Casey Rivera",
      flightNumber: "DL123",
      departureAirport: "JFK",
      departureAt: DEPARTURE,
      pickupAddressId: "a-1",
      bagCount: 2,
      pickupWindowStart: PICKUP_START,
      pickupWindowEnd: new Date(PICKUP_START.getTime() + 3_600_000),
      priceBreakdown: {
        baseFeeCents: 2900,
        bagsCents: 3000,
        distanceCents: 900,
        subtotalCents: 6800,
        leadTimeMultiplier: 1,
        leadTimeAdjustmentCents: 0,
        discounts: [],
        discountCents: 0,
        totalCents: 6800,
      },
    },
  ],
  users: [{ id: "u-1", email: null }],
  addresses: [
    {
      id: "a-1",
      line1: "1 Test St",
      line2: null,
      city: "New York",
      state: "NY",
      zip: "10001",
    },
  ],
  airports: [{ code: "JFK", tz: "America/New_York" }],
  ...overrides,
});

function harness(tables: FakeTables = seed()): {
  config: CoreConfig;
  notifier: RecordingNotifier;
} {
  const { db } = fakeDb(tables);
  const notifier = new RecordingNotifier();
  const config = createCoreConfig({
    db,
    payments: new FakePaymentProvider(),
    notifier,
    clock: fixedClock(NOW),
  });
  return { config, notifier };
}

describe("sendBookingConfirmationEmail", () => {
  it("sends the branded template, not a hand-rolled body", async () => {
    const { config, notifier } = harness();

    await sendBookingConfirmationEmail(config, {
      bookingId: "b-1",
      email: "guest@example.com",
      appOrigin: "https://koolee.test",
    });

    expect(notifier.emails).toHaveLength(1);
    const [message] = notifier.emails;

    // The template's subject leads with the ref; the old hand-rolled one led
    // with "Koolee pickup confirmed".
    expect(message!.subject).toBe("Pickup confirmed — KOO-7H2QM · DL123 from JFK");
    // HTML is what makes it the shared builder rather than a text-only body.
    expect(message!.html).toBeDefined();
    expect(message!.to).toBe("guest@example.com");

    // Deliberately the same assertions jobs/functions.test.ts makes of the
    // Inngest path, over the same fixture: if the two dispatch points ever
    // stop sharing an assembler, one of the two suites fails.
    expect(message!.body).toContain("Booking reference: KOO-7H2QM");
    expect(message!.body).toContain("Total: $68.00");
    expect(message!.body).toContain("airline's bag drop");
  });

  it("links the trip page ABSOLUTELY — a relative path is not a link in an inbox", async () => {
    const { config, notifier } = harness();

    await sendBookingConfirmationEmail(config, {
      bookingId: "b-1",
      email: "guest@example.com",
      appOrigin: "https://koolee.test/",
    });

    const [message] = notifier.emails;
    expect(message!.body).toContain("https://koolee.test/trips/b-1");
    expect(message!.html).toContain("https://koolee.test/trips/b-1");
    // The regression itself: no bare relative path anywhere.
    expect(message!.body).not.toContain("Track your pickup: /trips/");
  });

  it("omits the CTA entirely when no origin was injected", async () => {
    const { config, notifier } = harness();

    await sendBookingConfirmationEmail(config, {
      bookingId: "b-1",
      email: "guest@example.com",
    });

    const [message] = notifier.emails;
    expect(message!.body).not.toContain("Track your trip");
    // No link means no CTA button, which means Tag Orange appears nowhere.
    expect(message!.html).not.toContain("#FF6B35");
  });

  it("keeps the copy rules: bag drop, never check-in", async () => {
    const { config, notifier } = harness();

    await sendBookingConfirmationEmail(config, {
      bookingId: "b-1",
      email: "guest@example.com",
      appOrigin: "https://koolee.test",
    });

    const [message] = notifier.emails;
    expect(message!.body).toContain("deliver them to your airline's bag drop");
    expect(message!.body.toLowerCase()).not.toContain("check you in");
    expect(message!.html!.toLowerCase()).not.toContain("check you in");
  });

  it("renders times in the BOOKING's zone with the abbreviation", async () => {
    const { config, notifier } = harness();

    await sendBookingConfirmationEmail(config, {
      bookingId: "b-1",
      email: "guest@example.com",
      appOrigin: "https://koolee.test",
    });

    // 14:00Z on 3 Sep is 10:00 AM EDT — an email has no browser to fall back
    // on, so the zone has to be printed.
    expect(notifier.emails[0]!.body).toContain("EDT");
  });

  it("refuses a booking that does not exist rather than emailing a blank", async () => {
    const { config } = harness(seed({ bookings: [] }));

    await expect(
      sendBookingConfirmationEmail(config, {
        bookingId: "nope",
        email: "guest@example.com",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
