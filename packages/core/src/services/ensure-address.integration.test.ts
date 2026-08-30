import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addresses, createDb, users, zipCentroids, type Database } from "@koolee/db";

import { ensureAddress } from "./customers";

/**
 * `ensureAddress` — the dedupe key, and the coordinate upgrade.
 *
 * Two behaviours the Tier 5 pre-flight found and this slice changed:
 *
 *  - §6.3 — the early return happened BEFORE the coordinate branch, so an
 *    address a customer had used before could never gain the precise point or
 *    the `place_id` that Places autocomplete now supplies. The repeat address
 *    is the one most likely to matter.
 *  - the dedupe key ignored `line2`, collapsing two apartments at one street
 *    address into one row and sending a driver to the wrong door.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping ensureAddress tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** A covered ZIP, and the centroid the seed loads for it. */
const ZIP = "10018";
const CENTROID = { lat: 40.75544, lng: -73.9927 };
/** What Places would return for 22 W 34th St — a doorstep, not a ZIP's middle. */
const PRECISE = { lat: 40.749, lng: -73.9871 };

const BASE = {
  line1: "22 W 34th St",
  city: "New York",
  state: "NY",
  zip: ZIP,
};

describeIntegration("ensureAddress (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM addresses;
      DELETE FROM users;
      SET session_replication_role = DEFAULT;
    `);

    await db
      .insert(zipCentroids)
      .values({ zip: ZIP, ...CENTROID })
      .onConflictDoUpdate({ target: zipCentroids.zip, set: CENTROID });

    const [user] = await db
      .insert(users)
      .values({ role: "customer", fullName: "Casey Rivera" })
      .returning();
    userId = user!.id;
  });

  it("falls back to the ZIP centroid for a hand-typed address", async () => {
    const created = await ensureAddress(db, userId, BASE);

    expect(created.lat).toBeCloseTo(CENTROID.lat, 5);
    expect(created.lng).toBeCloseTo(CENTROID.lng, 5);
    expect(created.placeId).toBeNull();
  });

  it("stores precise coordinates and the place id when autocomplete supplies them", async () => {
    const created = await ensureAddress(db, userId, {
      ...BASE,
      ...PRECISE,
      placeId: "ChIJ_place_1",
    });

    expect(created.lat).toBeCloseTo(PRECISE.lat, 5);
    expect(created.placeId).toBe("ChIJ_place_1");
  });

  it("UPGRADES a returning customer's centroid row in place", async () => {
    const first = await ensureAddress(db, userId, BASE);
    expect(first.lat).toBeCloseTo(CENTROID.lat, 5);

    const second = await ensureAddress(db, userId, {
      ...BASE,
      ...PRECISE,
      placeId: "ChIJ_place_1",
    });

    // The same row, better data — not a second row.
    expect(second.id).toBe(first.id);
    expect(second.lat).toBeCloseTo(PRECISE.lat, 5);
    expect(second.lng).toBeCloseTo(PRECISE.lng, 5);
    expect(second.placeId).toBe("ChIJ_place_1");

    const rows = await db.select().from(addresses).where(eq(addresses.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("never downgrades: a later hand-typed booking keeps the precise point", async () => {
    const precise = await ensureAddress(db, userId, {
      ...BASE,
      ...PRECISE,
      placeId: "ChIJ_place_1",
    });

    const typed = await ensureAddress(db, userId, BASE);

    expect(typed.id).toBe(precise.id);
    expect(typed.lat).toBeCloseTo(PRECISE.lat, 5);
    expect(typed.placeId).toBe("ChIJ_place_1");
  });

  it("ignores half a coordinate — one number is not a point", async () => {
    const first = await ensureAddress(db, userId, BASE);
    const second = await ensureAddress(db, userId, { ...BASE, lat: PRECISE.lat });

    expect(second.id).toBe(first.id);
    expect(second.lat).toBeCloseTo(CENTROID.lat, 5);
  });

  it("keeps two apartments at one street address apart", async () => {
    const apt4 = await ensureAddress(db, userId, { ...BASE, line2: "Apt 4" });
    const apt9 = await ensureAddress(db, userId, { ...BASE, line2: "Apt 9" });
    const noApt = await ensureAddress(db, userId, BASE);

    expect(new Set([apt4.id, apt9.id, noApt.id]).size).toBe(3);
    expect(apt4.line2).toBe("Apt 4");
    expect(noApt.line2).toBeNull();
  });

  it("treats a blank line2 as no line2, so whitespace is not a second address", async () => {
    const first = await ensureAddress(db, userId, { ...BASE, line2: "   " });
    const second = await ensureAddress(db, userId, { ...BASE, line2: null });

    expect(second.id).toBe(first.id);
    expect(first.line2).toBeNull();
  });
});
