import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  passportVerifications,
  pricingRules,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { ConflictError, NotFoundError } from "../errors";
import { NotCheckedValidityChecker } from "../passport/checker";
import { createPassportValidityChecker } from "../passport/factory";
import { FakePaymentProvider } from "../payments/fake";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import {
  bookingPassportConfirmed,
  confirmPassport,
  getPassportVerification,
  recordAgentCapture,
  recordCustomerUpload,
} from "./passport";

/**
 * Manual passport verification at the core level:
 *
 *  - assignment is the authorization for every agent path;
 *  - confirmation works from BOTH entry states (a customer pre-upload, and
 *    `pending` where the agent photographs at the door — or photographs
 *    nothing at all);
 *  - the custody trail distinguishes who produced the evidence;
 *  - the row never learns anything about the document itself.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping passport tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("passport verification (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  let customerId: string;
  let agentUserId: string;
  let agentSession: AgentSession;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
    });

    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM agreement_acceptances;
      DELETE FROM agreement_versions;
      DELETE FROM passport_verifications;
      DELETE FROM payment_webhook_events;
      DELETE FROM payments;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
      DELETE FROM staff_members;
      DELETE FROM slot_blocks;
      DELETE FROM slots;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

    await db.insert(airports).values({
      code: "JFK",
      name: "John F. Kennedy International",
      tz: "America/New_York",
    });
    await db.insert(airlineCutoffs).values({
      airlineIata: "DL",
      airportCode: "JFK",
      scope: "domestic",
      cutoffMinutesBeforeDeparture: 45,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });
    await db.insert(pricingRules).values({
      name: "test",
      baseFeeCents: 2900,
      perBagCents: 1500,
      distanceMultiplier: "45.0000",
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551140001", role: "customer" })
      .returning();
    customerId = customer!.id;
    const [agent] = await db
      .insert(users)
      .values({ email: "passport.agent@koolee-test.example", role: "agent" })
      .returning();
    agentUserId = agent!.id;
    agentSession = { kind: "agent", role: "agent", userId: agentUserId };
  });

  async function assignedBooking() {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const end = new Date(Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
      pickupWindowStart: new Date(end.getTime() - HOUR),
      pickupWindowEnd: end,
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    await db
      .update(bookings)
      .set({ status: "agent_assigned" })
      .where(eq(bookings.id, booking.id));
    const [task] = await db
      .insert(verificationTasks)
      .values({
        bookingId: booking.id,
        assigneeUserId: agentUserId,
        status: "assigned",
        scheduledStart: new Date("2025-06-12T12:00:00Z"),
        scheduledEnd: new Date("2025-06-12T16:00:00Z"),
      })
      .returning();
    return { booking, task: task! };
  }

  async function eventTypes(bookingId: string) {
    const rows = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, bookingId));
    return rows.map((r) => r.eventType);
  }

  describe("the customer pre-upload", () => {
    it("creates the row on first upload and moves it to customer_uploaded", async () => {
      const { booking } = await assignedBooking();
      expect(await getPassportVerification(db, booking.id)).toBeNull();

      const row = await recordCustomerUpload(config, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/a.jpg`,
      });
      expect(row.status).toBe("customer_uploaded");
      expect(row.photoStoragePath).toBe(`passports/${booking.id}/a.jpg`);
      expect(row.uploadedAt).toEqual(now);
      // Never checked, and honestly so — no automated check ran.
      expect(row.validityCheckStatus).toBe("not_checked");
      expect(row.validityCheckProvider).toBeNull();

      expect(await eventTypes(booking.id)).toContain("passport.customer_uploaded");
    });

    it("allows a replacement while unconfirmed, and names the superseded path", async () => {
      const { booking } = await assignedBooking();
      await recordCustomerUpload(config, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/blurry.jpg`,
      });
      const replaced = await recordCustomerUpload(config, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/sharp.jpg`,
      });
      expect(replaced.photoStoragePath).toBe(`passports/${booking.id}/sharp.jpg`);

      // One row, two events: the trail records both captures, and the second
      // names what it replaced so an operator can still find the first object.
      const rows = await db
        .select()
        .from(passportVerifications)
        .where(eq(passportVerifications.bookingId, booking.id));
      expect(rows).toHaveLength(1);

      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const uploads = events.filter((e) => e.eventType === "passport.customer_uploaded");
      expect(uploads).toHaveLength(2);
      expect(uploads[1]!.metadata).toMatchObject({
        replacedStoragePath: `passports/${booking.id}/blurry.jpg`,
      });
    });

    it("refuses a replacement once the agent has confirmed", async () => {
      const { booking, task } = await assignedBooking();
      await recordCustomerUpload(config, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/a.jpg`,
      });
      await confirmPassport(config, agentSession, { taskId: task.id });

      await expect(
        recordCustomerUpload(config, {
          bookingId: booking.id,
          userId: customerId,
          storagePath: `passports/${booking.id}/b.jpg`,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("404s on someone else's booking", async () => {
      const { booking } = await assignedBooking();
      const [stranger] = await db
        .insert(users)
        .values({ phone: "+15551140009", role: "customer" })
        .returning();

      await expect(
        recordCustomerUpload(config, {
          bookingId: booking.id,
          userId: stranger!.id,
          storagePath: `passports/${booking.id}/a.jpg`,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      // Nothing was created for a booking the caller cannot see.
      expect(await getPassportVerification(db, booking.id)).toBeNull();
    });
  });

  describe("the agent at the door", () => {
    it("captures under a DISTINCT event name from the customer's upload", async () => {
      const { booking, task } = await assignedBooking();
      const row = await recordAgentCapture(config, agentSession, {
        taskId: task.id,
        storagePath: `passports/${booking.id}/door.jpg`,
      });
      expect(row.status).toBe("customer_uploaded");

      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const captured = events.find((e) => e.eventType === "passport.agent_captured");
      expect(captured).toBeDefined();
      expect(captured!.actorUserId).toBe(agentUserId);
      expect(captured!.actorRole).toBe("agent");
      // The path lands in photo_url exactly like `bag.sealed` — a PATH, never
      // a URL; whoever renders it signs it.
      expect(captured!.photoUrl).toBe(`passports/${booking.id}/door.jpg`);
      expect(events.map((e) => e.eventType)).not.toContain("passport.customer_uploaded");
    });

    it("confirms from pending — a pre-upload is a convenience, not a requirement", async () => {
      const { booking, task } = await assignedBooking();
      const row = await confirmPassport(config, agentSession, { taskId: task.id });

      expect(row.status).toBe("agent_confirmed");
      expect(row.confirmedByAgentId).toBe(agentUserId);
      expect(row.confirmedAt).toEqual(now);
      expect(row.photoStoragePath).toBeNull();
      expect(await bookingPassportConfirmed(db, booking.id)).toBe(true);

      // The event says whether there was a photo at all: the confirmation
      // means something different when there is nothing to look back at.
      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const confirmed = events.find((e) => e.eventType === "passport.agent_confirmed");
      expect(confirmed!.metadata).toMatchObject({ hadPhoto: false, taskId: task.id });
    });

    it("confirms from customer_uploaded, keeping the customer's photo", async () => {
      const { booking, task } = await assignedBooking();
      await recordCustomerUpload(config, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/pre.jpg`,
      });
      const row = await confirmPassport(config, agentSession, {
        taskId: task.id,
        lat: 40.7,
        lng: -74,
      });
      expect(row.status).toBe("agent_confirmed");
      expect(row.photoStoragePath).toBe(`passports/${booking.id}/pre.jpg`);

      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const confirmed = events.find((e) => e.eventType === "passport.agent_confirmed");
      expect(confirmed!.metadata).toMatchObject({ hadPhoto: true });
      expect(confirmed!.lat).toBeCloseTo(40.7);
    });

    it("is idempotent: a second confirm does not rewrite who vouched or when", async () => {
      const { task } = await assignedBooking();
      const first = await confirmPassport(config, agentSession, { taskId: task.id });

      const [other] = await db
        .insert(users)
        .values({ email: "second.agent@koolee-test.example", role: "agent" })
        .returning();
      // Reassign the task so the second agent's call is authorized — the point
      // here is that confirmation is not overwritten, not that it is refused.
      await db
        .update(verificationTasks)
        .set({ assigneeUserId: other!.id })
        .where(eq(verificationTasks.id, task.id));

      const again = await confirmPassport(
        config,
        { kind: "agent", role: "agent", userId: other!.id },
        { taskId: task.id },
      );
      expect(again.confirmedByAgentId).toBe(first.confirmedByAgentId);
      expect(again.confirmedAt).toEqual(first.confirmedAt);
      expect(await eventTypes(again.bookingId)).toEqual(
        expect.arrayContaining(["passport.agent_confirmed"]),
      );
      const rows = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, again.bookingId));
      expect(rows.filter((r) => r.eventType === "passport.agent_confirmed")).toHaveLength(
        1,
      );
    });

    it("assignment is the authorization: another agent's task 404s", async () => {
      const { booking, task } = await assignedBooking();
      const [other] = await db
        .insert(users)
        .values({ email: "unassigned.agent@koolee-test.example", role: "agent" })
        .returning();
      const otherSession: AgentSession = {
        kind: "agent",
        role: "agent",
        userId: other!.id,
      };

      await expect(
        confirmPassport(config, otherSession, { taskId: task.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        recordAgentCapture(config, otherSession, {
          taskId: task.id,
          storagePath: `passports/${booking.id}/x.jpg`,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await bookingPassportConfirmed(db, booking.id)).toBe(false);
    });
  });

  it("stores nothing about the document itself", async () => {
    const { booking, task } = await assignedBooking();
    await recordCustomerUpload(config, {
      bookingId: booking.id,
      userId: customerId,
      storagePath: `passports/${booking.id}/a.jpg`,
    });
    await confirmPassport(config, agentSession, { taskId: task.id });

    // Asserted against the DATABASE's own column list rather than the TS type:
    // the type is what we wrote, the catalog is what actually exists, and this
    // is the rule the table must not quietly lose.
    const columns = await sqlClient<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'passport_verifications'
    `;
    const names = columns.map((c) => c.column_name);
    for (const forbidden of [
      "passport_number",
      "document_number",
      "given_name",
      "surname",
      "full_name",
      "date_of_birth",
      "dob",
      "nationality",
      "mrz",
      "expires_at",
      "expiry_date",
    ]) {
      expect(names, `passport_verifications must never carry ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("the default validity checker reports not_checked and never blocks", async () => {
    for (const checker of [
      new NotCheckedValidityChecker(),
      createPassportValidityChecker({ kind: "none" }),
      config.passportValidityChecker,
    ]) {
      expect(await checker.check({ bookingId: "any", storagePath: "any" })).toEqual({
        status: "not_checked",
        provider: null,
      });
    }
  });
});
