import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agreementAcceptances,
  agreementVersions,
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  pricingRules,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { InvalidInputError, NotAuthorizedError, NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { errorChainMessage, pgErrorCode } from "../test-utils/db-errors";
import {
  acceptAgreement,
  bookingHasCurrentAcceptance,
  countBookingsNeedingReacceptance,
  getBookingAgreementState,
  getCurrentAgreementVersion,
  listAgreementVersions,
  publishAgreementVersion,
} from "./agreements";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";

/**
 * Versioned booking agreements at the core level:
 *
 *  - the current-version derivation, including across an `effective_from`
 *    boundary and with a scheduled-but-not-yet-live version present;
 *  - accept is idempotent, and only ever against the CURRENT version;
 *  - the gate flips false when a newer version goes live — the re-accept model;
 *  - publish assigns max+1 and refuses a retroactive effective date;
 *  - acceptances are append-only at the database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping agreement tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("booking agreements (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  let customerId: string;
  let adminId: string;

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
      .values({ phone: "+15551130001", role: "customer" })
      .returning();
    customerId = customer!.id;
    const [admin] = await db
      .insert(users)
      .values({ email: "agreements.admin@koolee-test.example", role: "admin" })
      .returning();
    adminId = admin!.id;
  });

  /** A `paid` booking — the earliest status at which accepting is meaningful. */
  async function paidBooking() {
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
    return booking;
  }

  async function seedVersion(
    version: number,
    effectiveFrom: Date,
    title = `v${version}`,
  ) {
    const [row] = await db
      .insert(agreementVersions)
      .values({ version, title, bodyMd: `Terms ${version}.`, effectiveFrom })
      .returning();
    return row!;
  }

  describe("current-version derivation", () => {
    it("is null when nothing has ever been published", async () => {
      expect(await getCurrentAgreementVersion(db, now)).toBeNull();
    });

    it("picks the highest version whose effective_from has passed", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const v2 = await seedVersion(2, new Date("2025-06-01T00:00:00Z"));
      // Scheduled but NOT yet live — publishing ahead of time must not change
      // what is in force today.
      await seedVersion(3, new Date("2025-07-01T00:00:00Z"));

      const current = await getCurrentAgreementVersion(db, now);
      expect(current!.id).toBe(v2.id);
      expect(current!.version).toBe(2);
    });

    it("flips at the effective_from boundary, exactly", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const boundary = new Date("2025-06-15T00:00:00Z");
      const v2 = await seedVersion(2, boundary);

      // One millisecond before: still v1.
      const before = await getCurrentAgreementVersion(
        db,
        new Date(boundary.getTime() - 1),
      );
      expect(before!.version).toBe(1);

      // At the instant itself: v2 (`effective_from <= now`, inclusive).
      const at = await getCurrentAgreementVersion(db, boundary);
      expect(at!.id).toBe(v2.id);
    });
  });

  describe("accepting", () => {
    it("records the acceptance, is idempotent, and appends exactly one custody event", async () => {
      const version = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();

      const first = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
        evidence: { userAgent: "test-agent/1.0" },
      });
      expect(first.created).toBe(true);
      expect(first.version.id).toBe(version.id);
      expect(first.acceptance.acceptedByUserId).toBe(customerId);
      expect(first.acceptance.evidence).toEqual({ userAgent: "test-agent/1.0" });

      // A double-submit is a no-op success, not a second row and not an error
      // the customer can do anything about.
      const second = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
      });
      expect(second.created).toBe(false);
      expect(second.acceptance.id).toBe(first.acceptance.id);

      const rows = await db
        .select()
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.bookingId, booking.id));
      expect(rows).toHaveLength(1);

      // The trail records what happened, and nothing happened the second time.
      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const accepted = events.filter((e) => e.eventType === "agreement.accepted");
      expect(accepted).toHaveLength(1);
      expect(accepted[0]!.actorUserId).toBe(customerId);
      expect(accepted[0]!.actorRole).toBe("customer");
      expect(accepted[0]!.metadata).toMatchObject({ agreementVersion: 1 });
    });

    it("evidence omits what the request did not carry rather than inventing it", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();

      const result = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
        evidence: { userAgent: "test-agent/1.0" },
      });
      expect(Object.keys(result.acceptance.evidence!)).toEqual(["userAgent"]);
      expect(result.acceptance.evidence).not.toHaveProperty("ip");
    });

    it("404s on someone else's booking — never a 403, which would confirm the id", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();
      const [stranger] = await db
        .insert(users)
        .values({ phone: "+15551130009", role: "customer" })
        .returning();

      await expect(
        acceptAgreement(config, { bookingId: booking.id, userId: stranger!.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuses once the visit has happened", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();
      await db
        .update(bookings)
        .set({ status: "verified_sealed" })
        .where(eq(bookings.id, booking.id));

      await expect(
        acceptAgreement(config, { bookingId: booking.id, userId: customerId }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });

    it("refuses when nothing has been published — the gate fails closed", async () => {
      const booking = await paidBooking();
      await expect(
        acceptAgreement(config, { bookingId: booking.id, userId: customerId }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await bookingHasCurrentAcceptance(db, booking.id, now)).toBe(false);
    });

    it("accepts the CURRENT version even when a stale one exists", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const v2 = await seedVersion(2, new Date("2025-06-01T00:00:00Z"));
      const booking = await paidBooking();

      const result = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
      });
      // The client never names a version; the server resolves it. A page that
      // rendered v1 cannot satisfy the gate by submitting v1.
      expect(result.version.id).toBe(v2.id);
    });
  });

  describe("the gate and the re-accept model", () => {
    it("goes false when a newer version publishes, and true again on re-accept", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();
      await acceptAgreement(config, { bookingId: booking.id, userId: customerId });
      expect(await bookingHasCurrentAcceptance(db, booking.id, now)).toBe(true);

      await publishAgreementVersion(config, {
        title: "v2",
        bodyMd: "Revised terms.",
        publishedBy: adminId,
      });

      // Un-gated: this customer has never seen the terms now in force.
      expect(await bookingHasCurrentAcceptance(db, booking.id, now)).toBe(false);

      const state = await getBookingAgreementState(db, booking.id, now);
      expect(state.accepted).toBe(false);
      // …and the UI can say "our agreement was updated" rather than the much
      // worse "you have not accepted", which is false to someone who did.
      expect(state.supersededAcceptance).toBe(true);
      expect(state.currentVersion!.version).toBe(2);

      await acceptAgreement(config, { bookingId: booking.id, userId: customerId });
      expect(await bookingHasCurrentAcceptance(db, booking.id, now)).toBe(true);

      // Both acceptances survive: the v1 one is still the evidence for what
      // was agreed while v1 was in force.
      const rows = await db
        .select()
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.bookingId, booking.id));
      expect(rows).toHaveLength(2);
    });
  });

  describe("publishing", () => {
    it("assigns max+1 and lists newest first", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      await seedVersion(2, new Date("2025-02-01T00:00:00Z"));

      const v3 = await publishAgreementVersion(config, {
        title: "Third",
        bodyMd: "Terms 3.",
        publishedBy: adminId,
      });
      expect(v3.version).toBe(3);
      expect(v3.publishedBy).toBe(adminId);

      expect((await listAgreementVersions(db)).map((v) => v.version)).toEqual([3, 2, 1]);
    });

    it("starts at 1 on an empty table", async () => {
      const v1 = await publishAgreementVersion(config, {
        title: "First",
        bodyMd: "Terms.",
        publishedBy: adminId,
      });
      expect(v1.version).toBe(1);
    });

    it("refuses a retroactive effective_from — it would un-accept in-flight bookings", async () => {
      await expect(
        publishAgreementVersion(config, {
          title: "Backdated",
          bodyMd: "Terms.",
          effectiveFrom: new Date(now.getTime() - 24 * HOUR),
          publishedBy: adminId,
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("allows a future effective_from, and it is not current until then", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const later = new Date(now.getTime() + 48 * HOUR);
      const v2 = await publishAgreementVersion(config, {
        title: "Scheduled",
        bodyMd: "Terms.",
        effectiveFrom: later,
        publishedBy: adminId,
      });

      expect((await getCurrentAgreementVersion(db, now))!.version).toBe(1);
      expect((await getCurrentAgreementVersion(db, later))!.id).toBe(v2.id);
    });

    it("refuses an empty title or body", async () => {
      await expect(
        publishAgreementVersion(config, {
          title: "   ",
          bodyMd: "Terms.",
          publishedBy: adminId,
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      await expect(
        publishAgreementVersion(config, {
          title: "Title",
          bodyMd: "  ",
          publishedBy: adminId,
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("counts the in-flight bookings a publish would ask to re-accept", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const a = await paidBooking();
      const b = await paidBooking();
      expect(await countBookingsNeedingReacceptance(db)).toBe(2);

      // A booking past the visit is not asked again — nothing is pending for it.
      await db
        .update(bookings)
        .set({ status: "verified_sealed" })
        .where(eq(bookings.id, b.id));
      expect(await countBookingsNeedingReacceptance(db)).toBe(1);
      expect(a.id).not.toBe(b.id);
    });
  });

  it("acceptances are append-only at the database, not merely by convention", async () => {
    await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
    const booking = await paidBooking();
    const { acceptance } = await acceptAgreement(config, {
      bookingId: booking.id,
      userId: customerId,
    });

    // drizzle wraps the Postgres error, so the trigger's message is on the
    // cause chain rather than on the top-level `Failed query: …`.
    const update = await db
      .update(agreementAcceptances)
      .set({ acceptedByUserId: adminId })
      .where(eq(agreementAcceptances.id, acceptance.id))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(update).not.toBeNull();
    expect(errorChainMessage(update)).toMatch(/append-only/i);
    // 23001 = restrict_violation, the SQLSTATE the trigger raises with.
    expect(pgErrorCode(update)).toBe("23001");

    const remove = await db
      .delete(agreementAcceptances)
      .where(eq(agreementAcceptances.id, acceptance.id))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(remove).not.toBeNull();
    expect(errorChainMessage(remove)).toMatch(/append-only/i);

    // The row is still there — the guard did not merely report, it refused.
    const [still] = await db
      .select()
      .from(agreementAcceptances)
      .where(eq(agreementAcceptances.id, acceptance.id));
    expect(still!.acceptedByUserId).toBe(customerId);
  });
});
