import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  driverPositionPings,
  driverPositions,
  driverShifts,
  staffMembers,
  trucks,
  users,
  type Database,
} from "@koolee/db";

import {
  listStalePositionShifts,
  POSITION_GAP_MS,
  prunePositionPings,
} from "./position-health";

/**
 * Gap detection and the retention sweep, against a real Postgres.
 *
 * WHY THESE CANNOT BE UNIT TESTS. Both are a single SQL statement each and
 * nothing else: `listStalePositionShifts` is a left join plus a three-clause
 * WHERE, and `prunePositionPings` is a bounded DELETE with a subquery. Mocking
 * the database here would test that the code calls drizzle — which is not the
 * thing that can be wrong. What can be wrong is the join dropping a driver who
 * has never pinged, or the grace period being applied to the wrong column, and
 * only a real query answers either.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping position-health tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const MIDTOWN = { lat: 40.75544, lng: -73.9927 };

describeIntegration("position health (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  const now = new Date("2026-09-06T15:00:00Z");
  /** Comfortably older than the grace period, so a shift can be flagged. */
  const shiftStartedAt = new Date(now.getTime() - 60 * 60_000);
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
    /*
     * `session_replication_role = replica` disables FK triggers, so the
     * cascade from `driver_shifts` does NOT fire and pings must be deleted
     * explicitly. Leaving them would make the retention tests count rows from
     * whichever test ran before them.
     */
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

  /**
   * A driver on an open shift, optionally with a last known fix.
   *
   * `startedAt` is settable because the grace period is measured from it —
   * a shift younger than the gap window has not had time to be late yet, and
   * that clause is one of the two things most worth pinning here.
   */
  async function driverOnShift(
    name: string,
    options: { lastSeenAt?: Date | null; startedAt?: Date; endedAt?: Date } = {},
  ): Promise<{ userId: string; shiftId: string }> {
    const [user] = await db
      .insert(users)
      .values({ email: `${name.replace(/\s+/g, "-").toLowerCase()}@koolee.test`, role: "agent", fullName: name })
      .returning();
    await db
      .insert(staffMembers)
      .values({ userId: user!.id, role: "agent", canDrive: true, active: true });

    truckCounter += 1;
    const [truck] = await db
      .insert(trucks)
      .values({ name: `Van ${name} ${truckCounter}`, bagCapacity: 30 })
      .returning();

    const [shift] = await db
      .insert(driverShifts)
      .values({
        staffUserId: user!.id,
        truckId: truck!.id,
        startedAt: options.startedAt ?? shiftStartedAt,
        ...(options.endedAt ? { endedAt: options.endedAt } : {}),
      })
      .returning();

    if (options.lastSeenAt) {
      await db.insert(driverPositions).values({
        staffUserId: user!.id,
        ...MIDTOWN,
        recordedAt: options.lastSeenAt,
      });
    }

    return { userId: user!.id, shiftId: shift!.id };
  }

  /* --- gap detection -------------------------------------------------- */

  describe("listStalePositionShifts", () => {
    it("leaves a driver who is reporting normally alone", async () => {
      await driverOnShift("Live Lena", { lastSeenAt: ago(30_000) });
      expect(await listStalePositionShifts(db, now)).toHaveLength(0);
    });

    /*
     * DELIBERATELY LOOSER THAN THE MAP'S 90-SECOND FRESHNESS BAR. Alerting at
     * 90s would page ops several times an hour per driver — every red light in
     * a tunnel — and be ignored inside a day.
     */
    it("leaves a driver two minutes quiet alone, past the map's freshness bar", async () => {
      await driverOnShift("Blinky Bo", { lastSeenAt: ago(120_000) });
      expect(await listStalePositionShifts(db, now)).toHaveLength(0);
    });

    it("flags a driver who has gone quiet past the gap window", async () => {
      const { shiftId } = await driverOnShift("Quiet Quinn", {
        lastSeenAt: ago(POSITION_GAP_MS + 60_000),
      });

      const stale = await listStalePositionShifts(db, now);
      expect(stale.map((s) => s.shiftId)).toEqual([shiftId]);
      expect(stale[0]!.fullName).toBe("Quiet Quinn");
      expect(stale[0]!.silentForMs).toBeGreaterThan(POSITION_GAP_MS);
    });

    /*
     * THE WORSE CASE, and the one a left join is easy to lose. A driver who
     * clocked on with location denied produces NO row in `driver_positions` at
     * all — an inner join would silently drop exactly the person most in need
     * of the nudge.
     */
    it("flags a driver whose phone has never reported at all", async () => {
      const { shiftId } = await driverOnShift("Silent Sam", { lastSeenAt: null });

      const stale = await listStalePositionShifts(db, now);
      expect(stale.map((s) => s.shiftId)).toEqual([shiftId]);
      expect(stale[0]!.lastSeenAt).toBeNull();
      expect(stale[0]!.silentForMs).toBeNull();
    });

    /*
     * THE GRACE PERIOD. Clocking on must not immediately raise an alarm about
     * a phone that simply has not produced its first fix yet — measured from
     * the SHIFT's start, which is the clause most likely to be written against
     * the wrong column.
     */
    it("gives a just-started shift time before flagging it", async () => {
      await driverOnShift("Fresh Fran", {
        lastSeenAt: null,
        startedAt: ago(30_000),
      });
      expect(await listStalePositionShifts(db, now)).toHaveLength(0);
    });

    it("ignores a shift that has ended", async () => {
      await driverOnShift("Gone Home", {
        lastSeenAt: ago(POSITION_GAP_MS + 60_000),
        endedAt: ago(600_000),
      });
      expect(await listStalePositionShifts(db, now)).toHaveLength(0);
    });

    it("carries the truck and the driver's name, for the console row", async () => {
      await driverOnShift("Named Nia", { lastSeenAt: null });
      const [stale] = await listStalePositionShifts(db, now);
      expect(stale!.fullName).toBe("Named Nia");
      expect(stale!.truckName).toContain("Van Named Nia");
      expect(stale!.shiftStartedAt).toBeInstanceOf(Date);
    });
  });

  /* --- retention ------------------------------------------------------ */

  describe("prunePositionPings", () => {
    async function seedPings(shiftId: string, userId: string, ages: number[]) {
      await db.insert(driverPositionPings).values(
        ages.map((ms) => ({
          staffUserId: userId,
          driverShiftId: shiftId,
          ...MIDTOWN,
          recordedAt: ago(ms),
        })),
      );
    }

    const days = (n: number) => n * 24 * 60 * 60_000;

    it("deletes rows past the window and keeps the rest", async () => {
      const { userId, shiftId } = await driverOnShift("Pruned Pat");
      await seedPings(shiftId, userId, [days(10), days(8), days(2), 60_000]);

      const result = await prunePositionPings(db, { now });

      expect(result.deleted).toBe(2);
      const left = await db.select().from(driverPositionPings);
      expect(left).toHaveLength(2);
      for (const row of left) {
        expect(now.getTime() - row.recordedAt.getTime()).toBeLessThan(days(7));
      }
    });

    it("deletes nothing when everything is inside the window", async () => {
      const { userId, shiftId } = await driverOnShift("Recent Rae");
      await seedPings(shiftId, userId, [days(1), 60_000]);

      expect((await prunePositionPings(db, { now })).deleted).toBe(0);
      expect(await db.select().from(driverPositionPings)).toHaveLength(2);
    });

    /*
     * BATCHED, because one unbounded DELETE over a week of rows takes a long
     * lock on the table the pinger is actively writing to. A sweep that falls
     * behind must show up as a non-zero count next hour, not as a stalled job
     * holding a lock.
     */
    it("stops at the batch size and leaves the rest for the next run", async () => {
      const { userId, shiftId } = await driverOnShift("Backlog Bea");
      await seedPings(
        shiftId,
        userId,
        Array.from({ length: 7 }, (_, i) => days(10) + i * 1_000),
      );

      const first = await prunePositionPings(db, { now, batchSize: 3 });
      expect(first.deleted).toBe(3);
      expect(await db.select().from(driverPositionPings)).toHaveLength(4);

      const second = await prunePositionPings(db, { now, batchSize: 10 });
      expect(second.deleted).toBe(4);
      expect(await db.select().from(driverPositionPings)).toHaveLength(0);
    });

    it("honours a custom retention window", async () => {
      const { userId, shiftId } = await driverOnShift("Tight Tina");
      await seedPings(shiftId, userId, [days(3), days(1)]);

      expect((await prunePositionPings(db, { now, olderThanDays: 2 })).deleted).toBe(1);
    });

    it("is safe to run against an empty table", async () => {
      expect((await prunePositionPings(db, { now })).deleted).toBe(0);
    });
  });
});
