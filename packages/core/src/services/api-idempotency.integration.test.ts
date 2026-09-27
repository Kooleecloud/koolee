import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiIdempotencyKeys, createDb, users, type Database } from "@koolee/db";

import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  pruneIdempotencyKeys,
  releaseIdempotencyKey,
} from "./api-idempotency";

/**
 * The claim/complete/release protocol against a real Postgres, because the
 * whole point is what happens when two requests race for one key: the
 * primary key decides, not application logic.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping api-idempotency tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

describeIntegration("api idempotency keys (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    const [user] = await db
      .insert(users)
      .values({ role: "agent", fullName: "Idempotency Tester" })
      .returning({ id: users.id });
    userId = user!.id;
  });

  beforeEach(async () => {
    await db.delete(apiIdempotencyKeys).where(eq(apiIdempotencyKeys.userId, userId));
  });

  afterAll(async () => {
    await db.delete(apiIdempotencyKeys).where(eq(apiIdempotencyKeys.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await sqlClient.end();
  });

  const base = { route: "POST /api/v1/shift/start", requestHash: "abc" };

  it("claims a fresh key once, then replays the stored answer", async () => {
    const first = await claimIdempotencyKey(db, { userId, key: "k1", ...base });
    expect(first).toEqual({ state: "claimed" });

    const inFlight = await claimIdempotencyKey(db, { userId, key: "k1", ...base });
    expect(inFlight).toEqual({ state: "in_progress" });

    await completeIdempotencyKey(db, {
      userId,
      key: "k1",
      status: 201,
      body: { ok: true },
    });

    const replay = await claimIdempotencyKey(db, { userId, key: "k1", ...base });
    expect(replay).toEqual({ state: "replay", status: 201, body: { ok: true } });
  });

  it("refuses the same key for a different route or body", async () => {
    await claimIdempotencyKey(db, { userId, key: "k2", ...base });
    await completeIdempotencyKey(db, { userId, key: "k2", status: 200, body: null });

    expect(
      await claimIdempotencyKey(db, {
        userId,
        key: "k2",
        route: base.route,
        requestHash: "zzz",
      }),
    ).toEqual({ state: "mismatch" });
    expect(
      await claimIdempotencyKey(db, {
        userId,
        key: "k2",
        route: "POST /api/v1/shift/end",
        requestHash: base.requestHash,
      }),
    ).toEqual({ state: "mismatch" });
  });

  it("scopes keys by user, so two drivers never collide", async () => {
    const [other] = await db
      .insert(users)
      .values({ role: "agent", fullName: "Other Tester" })
      .returning({ id: users.id });
    try {
      await claimIdempotencyKey(db, { userId, key: "shared", ...base });
      const theirs = await claimIdempotencyKey(db, {
        userId: other!.id,
        key: "shared",
        ...base,
      });
      expect(theirs).toEqual({ state: "claimed" });
    } finally {
      await db.delete(apiIdempotencyKeys).where(eq(apiIdempotencyKeys.userId, other!.id));
      await db.delete(users).where(eq(users.id, other!.id));
    }
  });

  it("release lets the next attempt run for real", async () => {
    await claimIdempotencyKey(db, { userId, key: "k3", ...base });
    await releaseIdempotencyKey(db, { userId, key: "k3" });
    expect(await claimIdempotencyKey(db, { userId, key: "k3", ...base })).toEqual({
      state: "claimed",
    });
  });

  it("only the loser of a concurrent claim sees in_progress", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimIdempotencyKey(db, { userId, key: "race", ...base }),
      ),
    );
    const claimed = results.filter((r) => r.state === "claimed");
    expect(claimed).toHaveLength(1);
    expect(results.filter((r) => r.state === "in_progress")).toHaveLength(4);
  });

  it("prunes rows past the retention window and keeps the rest", async () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    await claimIdempotencyKey(db, {
      userId,
      key: "old",
      ...base,
      now: new Date(now.getTime() - 25 * 60 * 60 * 1000),
    });
    await claimIdempotencyKey(db, { userId, key: "fresh", ...base, now });

    const { deleted } = await pruneIdempotencyKeys(db, { now });
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db.query.apiIdempotencyKeys.findMany({
      where: eq(apiIdempotencyKeys.userId, userId),
    });
    expect(remaining.map((r) => r.key)).toEqual(["fresh"]);
  });
});
