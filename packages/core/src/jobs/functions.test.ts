import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { RecordingNotifier, type EmailMessage } from "../notifications/notifier";
import { FakePaymentProvider } from "../payments/fake";
import { RecordingEmitter } from "../events/emitter";
import { createKooleeFunctions } from "./functions";
import {
  fakeDb,
  fakeLogger,
  FakeStep,
  RecordingInngest,
  type FakeTables,
  type RecordedFunction,
} from "./test-doubles";

/**
 * N6 — `jobs/functions.ts` had zero tests. All six functions run here against
 * faked deps.
 *
 * What is actually worth pinning, and why:
 *  - the confirmation and reminder both wrap their send in `try/catch` so a
 *    dead email provider cannot fail the flow. That guard existed and nothing
 *    proved it; a refactor could have deleted it silently.
 *  - the reminder's `sleepUntil` target and its `REMINDER_WORTHY` re-read are
 *    the two things that decide whether a customer gets a useful message or a
 *    wrong one. Neither is observable in production until it is wrong.
 *  - the exception alert's unset-address path must LOG AND RETURN, never throw
 *    — a missing env var must not turn into a failing job run.
 *
 * Throwing-notifier shape follows `waitlist/notify-covered.integration.test.ts`.
 */

const NOW = new Date("2026-09-01T12:00:00Z");
const PICKUP_START = new Date("2026-09-03T14:00:00Z");
const DEPARTURE = new Date("2026-09-03T22:00:00Z");

/** Refuses every email, the way a dead provider does. */
class ThrowingNotifier extends RecordingNotifier {
  override sendEmail(_message: EmailMessage): Promise<void> {
    return Promise.reject(new Error("provider refused the send"));
  }
}

/** Records alerts so the catch branches can be asserted on. */
class RecordingAlerter {
  readonly alerts: { severity: string; title: string }[] = [];
  async alert(event: { severity: string; title: string }): Promise<void> {
    this.alerts.push({ severity: event.severity, title: event.title });
  }
}

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: "b-1",
  ref: "KOO-7H2QM",
  userId: "u-1",
  status: "paid",
  paxName: "Casey Rivera",
  flightNumber: "DL123",
  airlineIata: "DL",
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
  ...overrides,
});

const seed = (overrides: FakeTables = {}): FakeTables => ({
  bookings: [booking()],
  users: [{ id: "u-1", email: "casey@example.com" }],
  addresses: [
    { id: "a-1", line1: "1 Test St", line2: null, city: "New York", state: "NY", zip: "10001" },
  ],
  airports: [{ code: "JFK", tz: "America/New_York" }],
  airlineCutoffs: [],
  verificationTasks: [],
  waitlistSignups: [],
  ...overrides,
});

interface Harness {
  functions: RecordedFunction[];
  notifier: RecordingNotifier;
  alerter: RecordingAlerter;
  emitter: RecordingEmitter;
  config: CoreConfig;
  updates: { values: Record<string, unknown> }[];
}

function harness(
  tables: FakeTables = seed(),
  options: { opsAlertEmail?: string; appOrigin?: string } = {
    opsAlertEmail: "ops@koolee.test",
    appOrigin: "https://koolee.test",
  },
  notifier: RecordingNotifier = new RecordingNotifier(),
): Harness {
  const { db, updates } = fakeDb(tables);
  const alerter = new RecordingAlerter();
  const emitter = new RecordingEmitter();
  const config = createCoreConfig({
    db,
    payments: new FakePaymentProvider(),
    notifier,
    opsAlerter: alerter,
    emitter,
    clock: fixedClock(NOW),
  });

  const inngest = new RecordingInngest();
  createKooleeFunctions(inngest.asClient(), () => config, options);
  return { functions: inngest.functions, notifier, alerter, emitter, config, updates };
}

const fn = (h: Harness, id: string): RecordedFunction => {
  const found = h.functions.find((f) => f.id === id);
  if (!found) throw new Error(`no function ${id}; got ${h.functions.map((f) => f.id).join(", ")}`);
  return found;
};

async function invoke(
  target: RecordedFunction,
  data: Record<string, unknown> = {},
): Promise<{ result: unknown; step: FakeStep; logger: ReturnType<typeof fakeLogger> }> {
  const step = new FakeStep();
  const logger = fakeLogger();
  const result = await target.handler({ event: { data }, step, logger });
  return { result, step, logger };
}

const confirmedEvent = {
  bookingId: "b-1",
  pickupStartAt: PICKUP_START.toISOString(),
  departureAt: DEPARTURE.toISOString(),
  customerPhone: "+15551230000",
  customerName: "Casey Rivera",
};

/* ------------------------------------------------------------------ */

describe("createKooleeFunctions — registration", () => {
  it("registers all six functions with the expected triggers", () => {
    const h = harness();
    expect(h.functions.map((f) => f.id).sort()).toEqual([
      "agent-no-show-check",
      "booking-confirmation-email",
      "booking-pickup-reminder",
      "cutoff-risk-monitor",
      "exception-ops-alert-email",
      "waitlist-zone-opened-sweep",
    ]);
    expect(fn(h, "cutoff-risk-monitor").crons).toEqual(["*/5 * * * *"]);
    expect(fn(h, "waitlist-zone-opened-sweep").crons).toEqual([
      "TZ=America/New_York 0 10 * * *",
    ]);
  });
});

describe("booking-confirmation-email", () => {
  it("sends exactly one email, with the ref and the price breakdown", async () => {
    const h = harness();
    const { result } = await invoke(fn(h, "booking-confirmation-email"), confirmedEvent);

    expect(result).toEqual({ sent: true, bookingId: "b-1" });
    expect(h.notifier.emails).toHaveLength(1);

    const email = h.notifier.emails[0]!;
    expect(email.to).toBe("casey@example.com");
    expect(email.subject).toContain("KOO-7H2QM");
    expect(email.body).toContain("Booking reference: KOO-7H2QM");
    expect(email.body).toContain("Total: $68.00");
    expect(email.body).toContain("https://koolee.test/trips/b-1");
    // The copy rule, at the point of send rather than only at the template.
    expect(email.body).toContain("airline's bag drop");
  });

  it("a thrown send is caught: the flow completes, ops is alerted, nothing throws", async () => {
    const h = harness(seed(), undefined, new ThrowingNotifier());
    const { result } = await invoke(fn(h, "booking-confirmation-email"), confirmedEvent);

    expect(result).toEqual({ sent: false, reason: "send_failed" });
    expect(h.alerter.alerts).toEqual([
      { severity: "warning", title: "Confirmation email failed for booking b-1" },
    ]);
  });

  it("skips a cancelled booking without sending", async () => {
    const h = harness(seed({ bookings: [booking({ status: "cancelled" })] }));
    const { result } = await invoke(fn(h, "booking-confirmation-email"), confirmedEvent);

    expect(result).toEqual({ sent: false, reason: "cancelled" });
    expect(h.notifier.emails).toHaveLength(0);
  });

  it("skips — and says so — when the customer has no email address", async () => {
    const h = harness(seed({ users: [{ id: "u-1", email: null }] }));
    const { result, logger } = await invoke(
      fn(h, "booking-confirmation-email"),
      confirmedEvent,
    );

    expect(result).toEqual({ sent: false, reason: "no_email" });
    expect(h.notifier.emails).toHaveLength(0);
    expect(logger.lines.join("\n")).toContain("no email");
  });
});

describe("booking-pickup-reminder", () => {
  it("sleeps until exactly two hours before the pickup window starts", async () => {
    const h = harness();
    const { step } = await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(step.slept).toHaveLength(1);
    expect(step.slept[0]!.id).toBe("wait-until-2h-before-pickup");
    expect(step.slept[0]!.at.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    expect(step.slept[0]!.at.getTime()).toBe(PICKUP_START.getTime() - 2 * 3_600_000);
  });

  it("sends immediately, without sleeping, when the window is already inside the lead", async () => {
    const h = harness();
    const soon = new Date(Date.now() + 30 * 60_000);
    const { step, logger } = await invoke(fn(h, "booking-pickup-reminder"), {
      ...confirmedEvent,
      pickupStartAt: soon.toISOString(),
    });

    expect(step.slept).toHaveLength(0);
    expect(logger.lines.join("\n")).toContain("sending immediately");
    expect(h.notifier.sms).toHaveLength(1);
  });

  it("sends both the SMS and the email for a reminder-worthy booking", async () => {
    const h = harness();
    await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(h.notifier.sms).toHaveLength(1);
    expect(h.notifier.sms[0]!.to).toBe("+15551230000");
    expect(h.notifier.sms[0]!.body).toContain("airline's bag drop");

    expect(h.notifier.emails).toHaveLength(1);
    expect(h.notifier.emails[0]!.subject).toContain("KOO-7H2QM");
  });

  /*
   * The guard that matters: the booking is re-read AFTER the sleep, so a trip
   * that was cancelled or already collected during those hours must not get a
   * "your pickup is in 2 hours" message.
   */
  it.each([
    ["cancelled", "status_cancelled"],
    ["exception", "status_exception"],
    ["verified_sealed", "status_verified_sealed"],
    ["completed", "status_completed"],
  ])("skips a %s booking at send time", async (status, reason) => {
    const h = harness(seed({ bookings: [booking({ status })] }));
    const { result } = await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(result).toMatchObject({ sms: { sent: false, reason } });
    expect(h.notifier.sms).toHaveLength(0);
    expect(h.notifier.emails).toHaveLength(0);
  });

  it.each(["paid", "agent_assigned"])("still reminds a %s booking", async (status) => {
    const h = harness(seed({ bookings: [booking({ status })] }));
    await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(h.notifier.sms).toHaveLength(1);
    expect(h.notifier.emails).toHaveLength(1);
  });

  it("skips when the booking no longer exists", async () => {
    const h = harness(seed({ bookings: [] }));
    const { result, logger } = await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(result).toMatchObject({ sms: { sent: false, reason: "booking_missing" } });
    expect(logger.lines.join("\n")).toContain("no longer exists");
  });

  it("a thrown reminder email is caught and ops-alerted, not thrown", async () => {
    const h = harness(seed(), undefined, new ThrowingNotifier());
    const { result } = await invoke(fn(h, "booking-pickup-reminder"), confirmedEvent);

    expect(result).toMatchObject({ email: { sent: false, reason: "send_failed" } });
    expect(h.alerter.alerts).toEqual([
      { severity: "warning", title: "Reminder email failed for booking b-1" },
    ]);
  });
});

describe("exception-ops-alert-email", () => {
  const exceptionEvent = {
    bookingId: "b-1",
    reason: "customer_not_home",
    raisedByUserId: "u-9",
  };

  it("emails the configured ops address, naming the booking by its ref", async () => {
    const h = harness();
    const { result } = await invoke(fn(h, "exception-ops-alert-email"), exceptionEvent);

    expect(result).toEqual({ sent: true });
    expect(h.notifier.emails).toHaveLength(1);

    const email = h.notifier.emails[0]!;
    expect(email.to).toBe("ops@koolee.test");
    expect(email.subject).toContain("KOO-7H2QM");
    expect(email.body).toContain("customer_not_home");
    expect(email.body).toContain("Raised by: u-9");
  });

  it("logs a skip and does NOT throw when OPS_ALERT_EMAIL is unset", async () => {
    const h = harness(seed(), { appOrigin: "https://koolee.test" });
    const { result, logger } = await invoke(
      fn(h, "exception-ops-alert-email"),
      exceptionEvent,
    );

    expect(result).toEqual({ sent: false, reason: "no_ops_email" });
    expect(h.notifier.emails).toHaveLength(0);
    expect(logger.lines.join("\n")).toContain("OPS_ALERT_EMAIL not configured");
  });

  it("escalates a failed alert send to critical rather than throwing", async () => {
    const h = harness(seed(), undefined, new ThrowingNotifier());
    const { result } = await invoke(fn(h, "exception-ops-alert-email"), exceptionEvent);

    expect(result).toEqual({ sent: false, reason: "send_failed" });
    expect(h.alerter.alerts).toEqual([
      { severity: "critical", title: "Exception email failed for booking b-1" },
    ]);
  });
});

describe("cutoff-risk-monitor (*/5 cron)", () => {
  it("is quiet when nothing is in transit", async () => {
    const h = harness(seed({ bookings: [] }));
    const { result, logger } = await invoke(fn(h, "cutoff-risk-monitor"));

    expect(result).toEqual({ alerted: 0 });
    expect(h.alerter.alerts).toHaveLength(0);
    expect(logger.lines.join("\n")).toContain("No in-transit bookings at risk");
  });

  it("alerts ops on an in-transit booking with no cutoff on record", async () => {
    const h = harness(
      seed({ bookings: [booking({ status: "in_transit" })], airlineCutoffs: [] }),
    );
    const { result } = await invoke(fn(h, "cutoff-risk-monitor"));

    expect(result).toEqual({ alerted: 1 });
    expect(h.alerter.alerts[0]!.title).toBe("Booking b-1 at risk of missing bag drop");
  });
});

describe("agent-no-show-check", () => {
  const noShowEvent = {
    bookingId: "b-1",
    slotStartAt: new Date("2026-09-03T13:00:00Z").toISOString(),
    assigneeUserId: "agent-1",
  };

  it("waits out the 15-minute grace period before deciding", async () => {
    const h = harness();
    const { step } = await invoke(fn(h, "agent-no-show-check"), noShowEvent);

    expect(step.slept).toHaveLength(1);
    expect(step.slept[0]!.at.toISOString()).toBe("2026-09-03T13:15:00.000Z");
  });

  it("escalates to ops when no task was ever started", async () => {
    const h = harness(
      seed({ verificationTasks: [{ id: "t-1", startedAt: null, status: "assigned" }] }),
    );
    const { result } = await invoke(fn(h, "agent-no-show-check"), noShowEvent);

    expect(result).toEqual({ escalated: true });
    expect(h.alerter.alerts).toEqual([
      { severity: "critical", title: "No agent check-in for booking b-1" },
    ]);
  });

  it("stays quiet when the agent checked in", async () => {
    const h = harness(
      seed({
        verificationTasks: [
          { id: "t-1", startedAt: new Date("2026-09-03T13:05:00Z"), status: "in_progress" },
        ],
      }),
    );
    const { result } = await invoke(fn(h, "agent-no-show-check"), noShowEvent);

    expect(result).toEqual({ escalated: false });
    expect(h.alerter.alerts).toHaveLength(0);
  });
});

describe("waitlist-zone-opened-sweep (daily cron)", () => {
  it("runs clean and stays silent when there is nothing queued", async () => {
    const h = harness();
    const { result, logger } = await invoke(fn(h, "waitlist-zone-opened-sweep"));

    expect(result).toEqual({ notified: 0, failed: 0, stillUncovered: 0 });
    expect(h.notifier.emails).toHaveLength(0);
    // Quiet when there is nothing to do — this cron runs every day forever.
    expect(logger.lines).toHaveLength(0);
  });

  it("emails a covered signup and stamps it", async () => {
    const h = harness(
      seed({
        waitlistSignups: [
          { id: "w-1", email: "waiting@example.com", zip: "10001", notifiedAt: null },
        ],
      }),
    );
    const { result } = await invoke(fn(h, "waitlist-zone-opened-sweep"));

    expect(result).toEqual({ notified: 1, failed: 0, stillUncovered: 0 });
    expect(h.notifier.emails[0]!.to).toBe("waiting@example.com");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.values).toEqual({ notifiedAt: NOW });
  });

  it("leaves a failed send unstamped so the next sweep retries it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness(
      seed({
        waitlistSignups: [
          { id: "w-1", email: "waiting@example.com", zip: "10001", notifiedAt: null },
        ],
      }),
      undefined,
      new ThrowingNotifier(),
    );
    const { result } = await invoke(fn(h, "waitlist-zone-opened-sweep"));

    expect(result).toEqual({ notified: 0, failed: 1, stillUncovered: 0 });
    expect(h.updates).toHaveLength(0);
    error.mockRestore();
  });
});

/* Kept last: a bare import of this module must never open a connection. */
describe("module import contract", () => {
  beforeEach(() => vi.resetModules());

  it("importing jobs/functions with no credentials does not throw", async () => {
    await expect(import("./functions")).resolves.toBeDefined();
  });
});
