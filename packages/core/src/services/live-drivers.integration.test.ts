import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  driverPositions,
  driverShifts,
  staffMembers,
  trucks,
  users,
  type Database,
} from "@koolee/db";

import { listLiveDrivers } from "./live-drivers";
import { POSITION_GAP_MS } from "./position-health";

/**
 * The admin map's read, against a real Postgres.
 *
 * WHY NOT A UNIT TEST. `listLiveDrivers` is one SELECT with a left join and a
 * correlated subquery, and the two things that can be wrong with it are both
 * SQL: the join dropping a driver who has never reported, and the order or
 * the open-shift filter being applied to the wrong column. Neither is visible
 * to a mock of drizzle.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping live-drivers tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const MIDTOWN = { lat: 40.75544, lng: -73.9927 };

describeIntegration("live drivers (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  const now = new Date("2026-09-27T15:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  let truckCounter = 0;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 4 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    // Same wipe as position-health: FK triggers are off under `replica`, so
    // every table is cleared explicitly rather than trusting the cascade.
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM driver_position_pings;
      DELETE FROM driver_positions;
      DELETE FROM driver_shifts;
      DELETE FROM trucks;
      DELETE FROM staff_members;
      DELETE FROM users;
      SET session_replication_role = DEFAULT;
    `);
    truckCounter = 0;
  });

  async function driverOnShift(
    name: string,
    options: {
      lastSeenAt?: Date | null;
      position?: { lat: number; lng: number };
      startedAt?: Date;
      endedAt?: Date;
    } = {},
  ): Promise<{ userId: string; shiftId: string; truckName: string }> {
    const [user] = await db
      .insert(users)
      .values({
        email: `${name.replace(/\s+/g, "-").toLowerCase()}@koolee.test`,
        role: "agent",
        fullName: name,
      })
      .returning();
    await db
      .insert(staffMembers)
      .values({ userId: user!.id, role: "agent", canDrive: true, active: true });

    truckCounter += 1;
    const truckName = `Van ${name} ${truckCounter}`;
    const [truck] = await db
      .insert(trucks)
      .values({ name: truckName, bagCapacity: 30 })
      .returning();

    const [shift] = await db
      .insert(driverShifts)
      .values({
        staffUserId: user!.id,
        truckId: truck!.id,
        startedAt: options.startedAt ?? ago(60 * 60_000),
        ...(options.endedAt ? { endedAt: options.endedAt } : {}),
      })
      .returning();

    if (options.lastSeenAt) {
      await db.insert(driverPositions).values({
        staffUserId: user!.id,
        ...(options.position ?? MIDTOWN),
        recordedAt: options.lastSeenAt,
      });
    }

    return { userId: user!.id, shiftId: shift!.id, truckName };
  }

  it("returns nobody when nobody is out", async () => {
    expect(await listLiveDrivers(db, now)).toEqual([]);
  });

  it("carries the shift, the person, the truck and the fix for a reporting driver", async () => {
    const { userId, shiftId, truckName } = await driverOnShift("Live Lena", {
      lastSeenAt: ago(20_000),
    });

    const [driver] = await listLiveDrivers(db, now);
    expect(driver).toMatchObject({
      shiftId,
      staffUserId: userId,
      fullName: "Live Lena",
      truckName,
      bagsOnBoard: 0,
      position: MIDTOWN,
      health: "live",
    });
    expect(driver!.recordedAt?.getTime()).toBe(ago(20_000).getTime());
  });

  /*
   * THE ROW THE LEFT JOIN EXISTS FOR. A driver who clocked on with location
   * denied has no `driver_positions` row at all; an inner join would drop
   * exactly the person the map most needs to show as missing.
   */
  it("keeps a driver who has never reported, with no position and silent health", async () => {
    const { shiftId } = await driverOnShift("Silent Sam", { lastSeenAt: null });

    const [driver] = await listLiveDrivers(db, now);
    expect(driver!.shiftId).toBe(shiftId);
    expect(driver!.position).toBeNull();
    expect(driver!.recordedAt).toBeNull();
    expect(driver!.health).toBe("silent");
  });

  it("calls a fix past the gap window stale, with the same rule as the console badge", async () => {
    await driverOnShift("Quiet Quinn", { lastSeenAt: ago(POSITION_GAP_MS + 30_000) });
    await driverOnShift("Edge Eddie", { lastSeenAt: ago(POSITION_GAP_MS) });

    const byName = new Map(
      (await listLiveDrivers(db, now)).map((d) => [d.fullName, d.health] as const),
    );
    expect(byName.get("Quiet Quinn")).toBe("stale");
    // At exactly the gap, `positionHealthOf` still says live (`>`, not `>=`).
    expect(byName.get("Edge Eddie")).toBe("live");
  });

  it("leaves out a shift that has ended, even with a recent fix", async () => {
    await driverOnShift("Gone Home", {
      lastSeenAt: ago(10_000),
      endedAt: ago(5_000),
    });
    expect(await listLiveDrivers(db, now)).toHaveLength(0);
  });

  it("lists the most recently started shift first", async () => {
    await driverOnShift("Early Erin", { startedAt: ago(3 * 60 * 60_000) });
    const { shiftId: latest } = await driverOnShift("Late Lou", {
      startedAt: ago(5 * 60_000),
    });

    const drivers = await listLiveDrivers(db, now);
    expect(drivers.map((d) => d.fullName)).toEqual(["Late Lou", "Early Erin"]);
    expect(drivers[0]!.shiftId).toBe(latest);
  });
});
