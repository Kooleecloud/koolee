import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addresses,
  airports,
  bookings,
  createDb,
  pickupTasks,
  pushSubscriptions,
  staffMembers,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import {
  RecordingNotifier,
  RecordingPushSender,
  type PushSendResult,
} from "../notifications";
import { FakePaymentProvider } from "../payments/fake";
import { createKooleeFunctions } from "./functions";
import { FakeStep, RecordingInngest, fakeLogger, type RecordedFunction } from "./test-doubles";

/**
 * F3 Phase 4 — moments × push, against a real database.
 *
 * NOT the `fakeDb` tier, deliberately. The whole question here is
 * **who received it**, and `fakeDb` ignores `where` clauses — every audience
 * query would return every row, so a test that passed would prove nothing.
 * Sending an agent's task notification to a customer is exactly the bug this
 * file exists to catch, and only a real database can catch it.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping push-moment tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const NOW = new Date("2026-06-10T10:00:00Z");

/** Refuses every send, the way a dead push provider does. */
class ThrowingPushSender extends RecordingPushSender {
  override send(): Promise<PushSendResult> {
    return Promise.reject(new Error("push service unreachable"));
  }
}

describeIntegration("push moments (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  let customerId: string;
  let agentId: string;
  let driverId: string;
  let adminId: string;
  let otherAdminId: string;
  let bookingId: string;
  let bookingRef: string;
  let verificationTaskId: string;
  let pickupTaskId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 8 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  interface Harness {
    functions: RecordedFunction[];
    push: RecordingPushSender;
    notifier: RecordingNotifier;
    config: CoreConfig;
  }

  function harness(sender: RecordingPushSender = new RecordingPushSender()): Harness {
    const notifier = new RecordingNotifier();
    const config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      notifier,
      pushSender: sender,
      clock: fixedClock(NOW),
    });
    const inngest = new RecordingInngest();
    createKooleeFunctions(inngest.asClient(), () => config, {
      opsAlertEmail: "ops@koolee.test",
      appOrigin: "https://koolee.test",
      agentAppOrigin: "https://agent.koolee.test",
      adminAppOrigin: "https://admin.koolee.test",
      supportEmail: "info@koolee.test",
    });
    return { functions: inngest.functions, push: sender, notifier, config };
  }

  const fn = (h: Harness, id: string): RecordedFunction => {
    const found = h.functions.find((f) => f.id === id);
    if (!found) throw new Error(`no function ${id}`);
    return found;
  };

  async function invoke(f: RecordedFunction, data: Record<string, unknown>) {
    const step = new FakeStep();
    const logger = fakeLogger();
    await f.handler({ event: { data }, step, logger });
    return { step, logger };
  }

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM push_subscriptions;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM custody_events;
      DELETE FROM bookings;
      DELETE FROM addresses;
      DELETE FROM staff_members;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);
    await db.insert(airports).values(TEST_AIRPORTS.JFK);

    const inserted = await db
      .insert(users)
      .values([
        { phone: "+15551170001", role: "customer", fullName: "Casey Rivera" },
        { email: "moments.agent@koolee-test.example", role: "agent", fullName: "Nina Alvarez" },
        { email: "moments.driver@koolee-test.example", role: "agent", fullName: "Marco Diaz" },
        { email: "moments.admin1@koolee-test.example", role: "admin" },
        { email: "moments.admin2@koolee-test.example", role: "admin" },
      ])
      .returning({ id: users.id });
    [customerId, agentId, driverId, adminId, otherAdminId] = inserted.map((r) => r.id) as [
      string,
      string,
      string,
      string,
      string,
    ];

    await db.insert(staffMembers).values([
      { userId: agentId, role: "agent", active: true },
      { userId: driverId, role: "agent", active: true, canDrive: true },
      { userId: adminId, role: "admin", active: true },
      { userId: otherAdminId, role: "admin", active: true },
    ]);

    const [address] = await db
      .insert(addresses)
      .values({
        userId: customerId,
        line1: "1 Test St",
        city: "New York",
        state: "NY",
        zip: "10001",
      })
      .returning({ id: addresses.id });

    const [booking] = await db
      .insert(bookings)
      .values({
        ref: "KOO-7H2QM",
        userId: customerId,
        status: "agent_assigned",
        flightNumber: "DL123",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt: new Date("2026-06-12T22:00:00Z"),
        paxName: "Casey Rivera",
        pickupAddressId: address!.id,
        bagCount: 2,
        pickupWindowStart: new Date("2026-06-12T01:00:00Z"),
        pickupWindowEnd: new Date("2026-06-12T02:00:00Z"),
        displayTz: "America/New_York",
        priceCents: 6800,
      })
      .returning({ id: bookings.id, ref: bookings.ref });
    bookingId = booking!.id;
    bookingRef = booking!.ref;

    const [vTask] = await db
      .insert(verificationTasks)
      .values({ bookingId, assigneeUserId: agentId, status: "assigned" })
      .returning({ id: verificationTasks.id });
    verificationTaskId = vTask!.id;

    const [pTask] = await db
      .insert(pickupTasks)
      .values({ bookingId, assigneeUserId: driverId, status: "assigned" })
      .returning({ id: pickupTasks.id });
    pickupTaskId = pTask!.id;
  });

  /** Gives somebody a device so they can be an audience. */
  async function subscribe(userId: string, label: string, app = "agent"): Promise<void> {
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint: `https://push.example/${label}`,
      p256dh: `p-${label}`,
      auth: `a-${label}`,
      app,
    });
  }

  /** Which user ids actually received a given send. */
  async function recipientsOf(targetIds: string[]): Promise<Set<string>> {
    const rows = await db
      .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
      .from(pushSubscriptions);
    const byId = new Map(rows.map((r) => [r.id, r.userId]));
    return new Set(targetIds.map((id) => byId.get(id)!).filter(Boolean));
  }

  /* ---------------------------------------------------------------- */
  /* agent assigned — two audiences, two tag strategies                */
  /* ---------------------------------------------------------------- */

  it("agent assigned: the customer gets a milestone, the agent gets a job", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");
    await subscribe(agentId, "nina-phone");
    await subscribe(driverId, "marco-phone");

    await invoke(fn(h, "agent-assigned-email"), { bookingId, agentUserId: agentId });

    expect(h.push.sends).toHaveLength(2);
    const [toCustomer, toAgent] = h.push.sends;

    // AUDIENCE. The driver is subscribed and must NOT be in either send.
    expect(await recipientsOf(toCustomer!.targets.map((t) => t.id))).toEqual(
      new Set([customerId]),
    );
    expect(await recipientsOf(toAgent!.targets.map((t) => t.id))).toEqual(new Set([agentId]));

    // The customer's collapses onto the booking; the agent's stacks per task.
    expect(toCustomer!.payload).toMatchObject({
      title: "Nina is your agent",
      tag: `booking:${bookingId}`,
      renotify: true,
      url: `https://koolee.test/trips/${bookingId}`,
    });
    expect(toCustomer!.urgency).toBe("normal");

    expect(toAgent!.payload).toMatchObject({
      title: "New visit assigned",
      tag: `verification-task:${verificationTaskId}`,
      url: `https://agent.koolee.test/tasks/${verificationTaskId}`,
    });
    expect(toAgent!.payload.renotify).toBeUndefined();
    expect(toAgent!.urgency).toBe("high");
  });

  it("carries no address and nothing passport-shaped in the body", async () => {
    const h = harness();
    await subscribe(agentId, "nina-phone");
    await invoke(fn(h, "agent-assigned-email"), { bookingId, agentUserId: agentId });

    // A push is decrypted onto a lock screen that may be face-up on a table.
    const bodies = h.push.sends.map((s) => `${s.payload.title} ${s.payload.body}`).join(" ");
    expect(bodies).toContain(bookingRef);
    expect(bodies).not.toContain("1 Test St");
    expect(bodies).not.toContain("10001");
    expect(bodies.toLowerCase()).not.toContain("passport");
  });

  it("says nothing about a cancelled booking", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));

    await invoke(fn(h, "agent-assigned-email"), { bookingId, agentUserId: agentId });
    expect(h.push.sends).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* driver selected — two audiences again                             */
  /* ---------------------------------------------------------------- */

  it("driver selected: the customer gets a milestone, the DRIVER gets the pickup", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");
    await subscribe(agentId, "nina-phone");
    await subscribe(driverId, "marco-phone");

    await invoke(fn(h, "driver-selected-email"), {
      bookingId,
      shiftId: "s-1",
      driverUserId: driverId,
    });

    expect(h.push.sends).toHaveLength(2);
    const [toCustomer, toDriver] = h.push.sends;

    // The AGENT is subscribed and is not the audience for either.
    expect(await recipientsOf(toCustomer!.targets.map((t) => t.id))).toEqual(
      new Set([customerId]),
    );
    expect(await recipientsOf(toDriver!.targets.map((t) => t.id))).toEqual(new Set([driverId]));

    expect(toCustomer!.payload).toMatchObject({
      title: "Marco is collecting your bags",
      tag: `booking:${bookingId}`,
      renotify: true,
    });
    expect(toDriver!.payload).toMatchObject({
      title: "New pickup on your shift",
      tag: `pickup-task:${pickupTaskId}`,
      url: `https://agent.koolee.test/tasks/${pickupTaskId}`,
    });
    expect(toDriver!.urgency).toBe("high");
  });

  /* ---------------------------------------------------------------- */
  /* customer milestones collapse onto ONE notification                */
  /* ---------------------------------------------------------------- */

  it("every customer milestone shares the booking's tag, so the latest wins", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");

    await invoke(fn(h, "agent-assigned-email"), { bookingId, agentUserId: agentId });
    await db.update(bookings).set({ status: "verified_sealed" }).where(eq(bookings.id, bookingId));
    await invoke(fn(h, "bags-sealed-email"), { bookingId });
    await invoke(fn(h, "bagdrop-delivered-email"), {
      bookingId,
      deliveredAt: NOW.toISOString(),
    });

    const customerSends = h.push.sends.filter(
      (s) => s.payload.tag === `booking:${bookingId}`,
    );
    expect(customerSends).toHaveLength(3);
    // One notification per booking, replaced as it moves on — a lock screen
    // shows where the bags ARE, not everywhere they have been.
    expect(customerSends.every((s) => s.payload.renotify === true)).toBe(true);
    expect(customerSends.map((s) => s.payload.title)).toEqual([
      "Nina is your agent",
      "Your bags are sealed",
      "Your bags are at the bag drop",
    ]);
  });

  it("the bag-drop copy never claims to check anybody in", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");
    await invoke(fn(h, "bagdrop-delivered-email"), {
      bookingId,
      deliveredAt: NOW.toISOString(),
    });

    const p = h.push.sends[0]!.payload;
    expect(`${p.title} ${p.body}`).toContain("bag drop");
    expect(`${p.title} ${p.body}`.toLowerCase()).not.toContain("checked you in");
  });

  /* ---------------------------------------------------------------- */
  /* ops audiences                                                     */
  /* ---------------------------------------------------------------- */

  it("an exception reaches every active admin, and nobody else, with a UNIQUE tag", async () => {
    const h = harness();
    await subscribe(adminId, "ops-laptop", "admin");
    await subscribe(otherAdminId, "ops-phone", "admin");
    await subscribe(customerId, "casey-phone", "web");
    await subscribe(agentId, "nina-phone");

    await invoke(fn(h, "exception-ops-alert-email"), {
      bookingId,
      reason: "customer not at the door",
    });

    expect(h.push.sends).toHaveLength(1);
    const send = h.push.sends[0]!;
    expect(await recipientsOf(send.targets.map((t) => t.id))).toEqual(
      new Set([adminId, otherAdminId]),
    );
    // Two bookings in exception are two problems: a collapsed notification
    // would hide the second one entirely.
    expect(send.payload.tag.startsWith(`exception:${bookingId}:`)).toBe(true);
    expect(send.payload.renotify).toBeUndefined();
    expect(send.payload.url).toBe(`https://admin.koolee.test/bookings/${bookingId}`);
    expect(send.urgency).toBe("high");
  });

  it("a deactivated admin drops out of the ops audience", async () => {
    const h = harness();
    await subscribe(adminId, "ops-laptop", "admin");
    await subscribe(otherAdminId, "ops-phone", "admin");
    await db
      .update(staffMembers)
      .set({ active: false })
      .where(eq(staffMembers.userId, otherAdminId));

    await invoke(fn(h, "exception-ops-alert-email"), { bookingId, reason: "x" });

    expect(await recipientsOf(h.push.sends[0]!.targets.map((t) => t.id))).toEqual(
      new Set([adminId]),
    );
  });

  it("an empty driver pool COLLAPSES per booking and re-alerts", async () => {
    const h = harness();
    await subscribe(adminId, "ops-laptop", "admin");

    await invoke(fn(h, "driver-pool-empty-ops-alert"), {
      bookingId,
      zip: "10001",
      bagCount: 2,
    });

    const send = h.push.sends[0]!;
    // One live alert per booking that re-alerts each time it recurs — the
    // opposite choice from the exception above, and for a reason: this is one
    // booking with a staffing problem, raised repeatedly until somebody
    // rosters a driver.
    expect(send.payload).toMatchObject({
      tag: `driver-pool-empty:${bookingId}`,
      renotify: true,
    });
  });

  it("ops push does NOT depend on OPS_ALERT_EMAIL — a different channel to different people", async () => {
    const notifier = new RecordingNotifier();
    const sender = new RecordingPushSender();
    const config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      notifier,
      pushSender: sender,
      clock: fixedClock(NOW),
    });
    const inngest = new RecordingInngest();
    // No opsAlertEmail at all.
    createKooleeFunctions(inngest.asClient(), () => config, {
      adminAppOrigin: "https://admin.koolee.test",
    });
    await subscribe(adminId, "ops-laptop", "admin");

    const f = inngest.functions.find((x) => x.id === "exception-ops-alert-email")!;
    await invoke(f, { bookingId, reason: "no email configured" });

    expect(notifier.emails).toHaveLength(0);
    expect(sender.sends).toHaveLength(1);
  });

  it("sends nothing when no admin has a subscription", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");
    await invoke(fn(h, "exception-ops-alert-email"), { bookingId, reason: "x" });
    expect(h.push.sends).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* push is never load-bearing                                        */
  /* ---------------------------------------------------------------- */

  it("a THROWING sender leaves the email and the function intact", async () => {
    const h = harness(new ThrowingPushSender());
    await subscribe(customerId, "casey-phone", "web");
    await db.update(users).set({ email: "casey@example.com" }).where(eq(users.id, customerId));

    const { step } = await invoke(fn(h, "agent-assigned-email"), {
      bookingId,
      agentUserId: agentId,
    });

    // The email went. The function completed. Both steps ran.
    expect(h.notifier.emails).toHaveLength(1);
    expect(h.notifier.emails[0]!.to).toBe("casey@example.com");
    expect(step.ran).toEqual(["send-agent-assigned-email", "push-agent-assigned"]);

    // And the subscription is still there: a provider outage must not
    // unsubscribe anybody.
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
  });

  it("the push runs in its OWN step, after the email — never inside it", async () => {
    const h = harness();
    await subscribe(customerId, "casey-phone", "web");

    const { step } = await invoke(fn(h, "bags-sealed-email"), { bookingId });

    // Independent memoization: a retried email step does not re-send the
    // push, and a retried push does not re-send the email.
    expect(step.ran).toEqual(["send-bags-sealed-email", "push-bags-sealed"]);
  });

  it("omits the deep link rather than sending a relative one", async () => {
    const notifier = new RecordingNotifier();
    const sender = new RecordingPushSender();
    const config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      notifier,
      pushSender: sender,
      clock: fixedClock(NOW),
    });
    const inngest = new RecordingInngest();
    // No origins injected at all.
    createKooleeFunctions(inngest.asClient(), () => config, {});
    await subscribe(customerId, "casey-phone", "web");
    await subscribe(agentId, "nina-phone");

    const f = inngest.functions.find((x) => x.id === "agent-assigned-email")!;
    await invoke(f, { bookingId, agentUserId: agentId });

    // A relative path is not a link in a notification. The push still goes.
    for (const send of sender.sends) {
      expect(send.payload.url).toBeUndefined();
      expect(send.targets.length).toBeGreaterThan(0);
    }
  });
});
