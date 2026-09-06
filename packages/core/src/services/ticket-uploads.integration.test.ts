import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  pricingRules,
  ticketUploads,
  users,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakeTicketExtractor } from "../extraction/fake";
import { FakePaymentProvider } from "../payments/fake";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import {
  attachTicketUploadsToUser,
  createTicketUpload,
  listTicketUploadsForDraft,
  setTicketUploadStatus,
} from "./ticket-uploads";

/**
 * Phase 3 acceptance at the persistence layer: the guest-first `ticket_uploads`
 * linkage, and the HARD RULE — raw extraction output never reaches booking
 * fields. The flow simulated here is exactly the app's: upload (guest,
 * draft-keyed) → extraction PREFILLS the review form → the user EDITS a field
 * → the confirmed values create the booking. The extractor's original wrong
 * value must then appear nowhere.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping ticket-uploads tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;
/** A clock-aligned one-hour pickup window, mid-band and notice-safe. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("ticket uploads (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
    });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
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
      airlineIata: "UA",
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
  });

  it("guest upload → user attach at the payment gate → confirmed (edited) values book; the raw extraction value appears nowhere", async () => {
    const draftId = crypto.randomUUID();

    // 1. Guest upload, recorded against the cookie draft — no user yet.
    const upload = await createTicketUpload(db, {
      draftId,
      storagePath: `tickets/${draftId}/${crypto.randomUUID()}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 12345,
      checksum: "a".repeat(64),
    });
    expect(upload.userId).toBeNull();
    expect(upload.extractionStatus).toBe("pending");

    // 2. Extraction runs — the fake returns a WRONG passenger name the user
    //    will correct on the review form.
    const extractor = new FakeTicketExtractor({
      airlineIata: "UA",
      flightNumber: "UA1189",
      departureAtLocal: "2025-06-12T18:00",
      departureAirport: "JFK",
      paxName: "Wrong Name From Extraction",
      confidence: "high",
    });
    const outcome = await extractor.extract({
      data: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    expect(outcome.status).toBe("extracted");
    await setTicketUploadStatus(db, { id: upload.id, status: "extracted" });

    // 3. The review form: user confirms the flight but EDITS the name.
    const confirmed = {
      flightNumber: "UA1189",
      airlineIata: "UA",
      departureAirport: "JFK" as const,
      paxName: "Jordan Alvarez",
    };

    // 4. Verification passes; the user id attaches to the draft's uploads at
    //    the payment gate.
    const [user] = await db
      .insert(users)
      .values({ phone: "+15551117001", role: "customer" })
      .returning();
    const attached = await attachTicketUploadsToUser(db, {
      draftId,
      userId: user!.id,
    });
    expect(attached).toBe(1);

    const [afterAttach] = await listTicketUploadsForDraft(db, draftId);
    expect(afterAttach?.userId).toBe(user!.id);

    // Attaching is idempotent and never re-assigns.
    const [other] = await db
      .insert(users)
      .values({ phone: "+15551117002", role: "customer" })
      .returning();
    expect(await attachTicketUploadsToUser(db, { draftId, userId: other!.id })).toBe(0);

    // 5. The booking is created from the CONFIRMED values only.
    const address = await ensureAddress(db, user!.id, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: user!.id,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      ...windowFor(departureAt),
      flightNumber: confirmed.flightNumber,
      airlineIata: confirmed.airlineIata,
      departureAirport: confirmed.departureAirport,
      departureAt,
      scope: "domestic",
      paxName: confirmed.paxName,
      bagCount: 1,
      distanceKm: 20,
    });

    expect(booking.paxName).toBe("Jordan Alvarez");

    // 6. HARD RULE: the extractor's original wrong value appears nowhere —
    //    not on the booking, and not anywhere else in the database.
    const [bookingRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(bookingRow!.paxName).not.toBe("Wrong Name From Extraction");

    const tables = ["bookings", "users", "ticket_uploads", "custody_events", "bags"];
    for (const table of tables) {
      const rows = (await db.execute(
        sql.raw(
          `select count(*)::int as n from ${table} where ${table}::text ilike '%Wrong Name From Extraction%'`,
        ),
      )) as unknown as Array<{ n: number }>;
      expect(rows[0]?.n, `raw extraction value leaked into ${table}`).toBe(0);
    }

    // The upload row records bookkeeping only — status, path, checksum.
    const [finalUpload] = await db
      .select()
      .from(ticketUploads)
      .where(eq(ticketUploads.id, upload.id));
    expect(finalUpload!.extractionStatus).toBe("extracted");
    expect(finalUpload!.userId).toBe(user!.id);
  });
});
