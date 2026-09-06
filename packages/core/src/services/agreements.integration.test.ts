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
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { InvalidInputError, NotAuthorizedError, NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { errorChainMessage, pgErrorCode } from "../test-utils/db-errors";
import {
  acceptAgreement,
  bookingHasAcceptedAgreement,
  getBookingAgreementState,
  getAgreementVersionById,
  countAgreementVersions,
  getCurrentAgreementVersion,
  isAgreementVersionEditable,
  listAgreementVersions,
  publishAgreementVersion,
  updateScheduledAgreementVersion,
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

    await db.insert(airports).values(TEST_AIRPORTS.JFK);
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
      quotedZip: address.zip,
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

  /**
   * ZERO VERSIONS IS AN OUTAGE, and the console's alarm depends on this
   * count. `getCurrentAgreementVersion` cannot answer it: a version scheduled
   * for next week makes that null while somebody has plainly done the work,
   * and an alarm raised then would be noise nobody keeps looking at.
   */
  describe("countAgreementVersions", () => {
    it("is zero on a database that has never published one", async () => {
      expect(await countAgreementVersions(db)).toBe(0);
    });

    it("counts scheduled and superseded versions, not just the current one", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z")); // superseded
      await seedVersion(2, new Date("2025-06-01T00:00:00Z")); // current
      await seedVersion(3, new Date("2099-01-01T00:00:00Z")); // scheduled
      expect(await countAgreementVersions(db)).toBe(3);
    });

    it("is non-zero while the current version is null — the case the alarm must NOT fire on", async () => {
      await seedVersion(1, new Date("2099-01-01T00:00:00Z"));
      expect(await getCurrentAgreementVersion(db, now)).toBeNull();
      expect(await countAgreementVersions(db)).toBe(1);
    });
  });

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
      expect(await bookingHasAcceptedAgreement(db, booking.id)).toBe(false);
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

  /**
   * VERSION PINNING. The version a booking accepts governs it for life.
   * Publishing a newer one never disturbs a booking already agreed — which is
   * the opposite of the re-acceptance model this replaced, so these tests are
   * the specification of that decision.
   */
  describe("version pinning", () => {
    it("stays accepted when a newer version publishes, and stays pinned to the OLD one", async () => {
      const v1 = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();
      await acceptAgreement(config, { bookingId: booking.id, userId: customerId });
      expect(await bookingHasAcceptedAgreement(db, booking.id)).toBe(true);

      await publishAgreementVersion(config, {
        title: "v2",
        bodyMd: "Revised terms.",
        publishedBy: adminId,
      });

      // The gate does not budge. Nobody is asked again.
      expect(await bookingHasAcceptedAgreement(db, booking.id)).toBe(true);

      // …and every surface still shows the terms this booking is bound by,
      // not the ones now on sale.
      const state = await getBookingAgreementState(db, booking.id, now);
      expect(state.accepted).toBe(true);
      expect(state.acceptedVersion!.id).toBe(v1.id);
      expect(state.acceptedVersion!.version).toBe(1);
      expect(state.currentVersion!.version).toBe(1);
    });

    it("re-accepting after a publish is a no-op that does NOT re-pin the booking", async () => {
      const v1 = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const booking = await paidBooking();
      const first = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
      });

      const v2 = await publishAgreementVersion(config, {
        title: "v2",
        bodyMd: "Revised terms.",
        publishedBy: adminId,
      });

      // A stray second call — a retry, a stale tab, a future code path — must
      // not silently move this booking onto terms it never agreed to.
      const again = await acceptAgreement(config, {
        bookingId: booking.id,
        userId: customerId,
      });
      expect(again.created).toBe(false);
      expect(again.acceptance.id).toBe(first.acceptance.id);
      expect(again.version.id).toBe(v1.id);
      expect(again.version.id).not.toBe(v2.id);

      // One acceptance per booking, ever.
      const rows = await db
        .select()
        .from(agreementAcceptances)
        .where(eq(agreementAcceptances.bookingId, booking.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.agreementVersionId).toBe(v1.id);
    });

    it("a booking made AFTER the publish pins to the newer version", async () => {
      await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const older = await paidBooking();
      await acceptAgreement(config, { bookingId: older.id, userId: customerId });

      const v2 = await publishAgreementVersion(config, {
        title: "v2",
        bodyMd: "Revised terms.",
        publishedBy: adminId,
      });

      const newer = await paidBooking();
      const accepted = await acceptAgreement(config, {
        bookingId: newer.id,
        userId: customerId,
      });
      expect(accepted.version.id).toBe(v2.id);

      // Two bookings, two different pinned versions, both correct.
      const olderState = await getBookingAgreementState(db, older.id, now);
      expect(olderState.acceptedVersion!.version).toBe(1);
      const newerState = await getBookingAgreementState(db, newer.id, now);
      expect(newerState.acceptedVersion!.version).toBe(2);
    });

    it("the database refuses a second acceptance for the same booking", async () => {
      const v1 = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const v2 = await seedVersion(2, new Date("2025-06-01T00:00:00Z"));
      const booking = await paidBooking();
      await db.insert(agreementAcceptances).values({
        bookingId: booking.id,
        agreementVersionId: v1.id,
        acceptedByUserId: customerId,
      });

      // The service is what returns a friendly no-op; THIS is what makes a
      // concurrent double-insert impossible (migration 0025).
      const clash = await db
        .insert(agreementAcceptances)
        .values({
          bookingId: booking.id,
          agreementVersionId: v2.id,
          acceptedByUserId: customerId,
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(clash).not.toBeNull();
      expect(pgErrorCode(clash)).toBe("23505");
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
  });

  /**
   * A version freezes the moment it takes effect. Before that it is safe to
   * edit — it is not current, so `acceptAgreement` cannot have pointed at it,
   * so no acceptance can be rewritten. That is what makes scheduling double as
   * the draft mechanism.
   */
  describe("editing a scheduled version", () => {
    /**
     * These tests run on the SYSTEM clock, not the fixed one the rest of the
     * file uses. The freeze rule is enforced by a database trigger reading
     * `now()`, so "scheduled" has to mean scheduled in real time — a fixed
     * 2025 clock would schedule a version the database considers long past,
     * which is a property of the fixture, not of the code.
     */
    let liveConfig: CoreConfig;
    const realNow = () => new Date();

    beforeEach(() => {
      liveConfig = createCoreConfig({ db, payments: new FakePaymentProvider() });
    });

    it("edits title, body and effective date while it is still in the future", async () => {
      const later = new Date(realNow().getTime() + 48 * HOUR);
      const scheduled = await publishAgreementVersion(liveConfig, {
        title: "Scheduled",
        bodyMd: "Draft terms.",
        effectiveFrom: later,
        publishedBy: adminId,
      });
      expect(isAgreementVersionEditable(scheduled, realNow())).toBe(true);

      const evenLater = new Date(realNow().getTime() + 96 * HOUR);
      const result = await updateScheduledAgreementVersion(liveConfig, {
        id: scheduled.id,
        title: "Scheduled, revised",
        bodyMd: "Revised draft terms.",
        effectiveFrom: evenLater,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.version.title).toBe("Scheduled, revised");
      expect(result.version.bodyMd).toBe("Revised draft terms.");
      expect(result.version.effectiveFrom).toEqual(evenLater);
      // The version NUMBER never moves — editing is not republishing.
      expect(result.version.version).toBe(scheduled.version);
    });

    it("refuses once the version is in effect, and says so usefully", async () => {
      const live = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      expect(isAgreementVersionEditable(live, realNow())).toBe(false);

      const result = await updateScheduledAgreementVersion(liveConfig, {
        id: live.id,
        title: "Sneaky edit",
        bodyMd: "Different terms.",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/can no longer be edited/i);

      // The stored document is untouched — the guard refused, it did not warn.
      const after = await getAgreementVersionById(db, live.id);
      expect(after!.title).toBe("v1");
      expect(after!.bodyMd).toBe("Terms 1.");
    });

    it("refuses to backdate a scheduled version into the past", async () => {
      const scheduled = await publishAgreementVersion(liveConfig, {
        title: "Scheduled",
        bodyMd: "Terms.",
        effectiveFrom: new Date(realNow().getTime() + 48 * HOUR),
        publishedBy: adminId,
      });

      await expect(
        updateScheduledAgreementVersion(liveConfig, {
          id: scheduled.id,
          title: "Scheduled",
          bodyMd: "Terms.",
          effectiveFrom: new Date(realNow().getTime() - 24 * HOUR),
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("the database refuses too, not just the service", async () => {
      // The guard has to hold for psql and for any future second write path,
      // exactly like the custody and acceptance triggers.
      const live = await seedVersion(1, new Date("2025-01-01T00:00:00Z"));
      const direct = await db
        .update(agreementVersions)
        .set({ bodyMd: "rewritten behind the service" })
        .where(eq(agreementVersions.id, live.id))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(direct).not.toBeNull();
      expect(errorChainMessage(direct)).toMatch(/frozen/i);
      expect(pgErrorCode(direct)).toBe("23001");

      const deletion = await db
        .delete(agreementVersions)
        .where(eq(agreementVersions.id, live.id))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(deletion).not.toBeNull();
      expect(errorChainMessage(deletion)).toMatch(/cannot be deleted/i);
    });

    it("a scheduled version that has been accepted cannot be edited", async () => {
      // Unreachable through the app today (only the current version can be
      // accepted), which is exactly why the guard is asserted rather than
      // assumed — it is what protects a future second acceptance path.
      const scheduled = await publishAgreementVersion(liveConfig, {
        title: "Scheduled",
        bodyMd: "Terms.",
        effectiveFrom: new Date(realNow().getTime() + 48 * HOUR),
        publishedBy: adminId,
      });
      const booking = await paidBooking();
      await db.insert(agreementAcceptances).values({
        bookingId: booking.id,
        agreementVersionId: scheduled.id,
        acceptedByUserId: customerId,
      });

      const result = await updateScheduledAgreementVersion(liveConfig, {
        id: scheduled.id,
        title: "Changed after acceptance",
        bodyMd: "Changed.",
      });
      expect(result.ok).toBe(false);
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
