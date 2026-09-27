import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, driverPushTokens, users, type Database } from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { InvalidInputError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import {
  disableDriverPushTokens,
  isExpoPushToken,
  listDriverPushTokens,
  registerDriverPushToken,
  unregisterDriverPushToken,
} from "./driver-push-tokens";

/**
 * Phase 5 — Expo token storage and authorization.
 *
 * The properties that need a real database are the same two as for web
 * subscriptions: the unique index is on `token` ALONE so a phone that
 * changes hands MOVES, and every write is scoped by `user_id` so knowing a
 * token is not enough to silence somebody's phone. Plus the one that is
 * new: a disabled token is revived by a re-register, not duplicated.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping driver-push-token tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

describe("isExpoPushToken (pure)", () => {
  it("accepts the two bracketed forms and the legacy uuid form", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("7f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b")).toBe(true);
  });

  it("refuses an FCM token, an APNs hex token, an empty bracket, and a non-string", () => {
    expect(isExpoPushToken("fcm:dGhpcyBpcyBub3Q")).toBe(false);
    expect(isExpoPushToken("a".repeat(64))).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
  });
});

describeIntegration("driver push tokens (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  const now = new Date("2026-09-27T10:00:00Z");
  let alice: string;
  let bob: string;

  function configWith(clock = fixedClock(now)): CoreConfig {
    return createCoreConfig({ db, payments: new FakePaymentProvider(), clock });
  }

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 8 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM driver_push_tokens;
      DELETE FROM users;
      SET session_replication_role = DEFAULT;
    `);

    const inserted = await db
      .insert(users)
      .values([
        { email: "alice.driver@koolee-test.example", role: "agent" },
        { email: "bob.driver@koolee-test.example", role: "agent" },
      ])
      .returning({ id: users.id });
    alice = inserted[0]!.id;
    bob = inserted[1]!.id;
  });

  /* ---------------------------------------------------------------- */
  /* Upsert semantics                                                  */
  /* ---------------------------------------------------------------- */

  it("stores one row per device, and one person may have several", async () => {
    const config = configWith();
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
      deviceLabel: "iPhone",
    });
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_B,
      platform: "android",
    });

    const mine = await listDriverPushTokens(db, [alice]);
    expect(mine.map((t) => [t.token, t.platform]).sort()).toEqual([
      [TOKEN_A, "ios"],
      [TOKEN_B, "android"],
    ]);
  });

  it("re-registering the same token UPDATES rather than duplicating", async () => {
    const config = configWith();
    const first = await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
      deviceLabel: "iPhone",
    });
    const later = new Date("2026-09-28T10:00:00Z");
    const second = await registerDriverPushToken(configWith(fixedClock(later)), {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
      deviceLabel: "iPhone 17",
    });

    expect(second.id).toBe(first.id);
    const [row] = await db
      .select()
      .from(driverPushTokens)
      .where(eq(driverPushTokens.id, first.id));
    expect(row).toMatchObject({ deviceLabel: "iPhone 17", lastSeenAt: later });
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(1);
  });

  it("a phone that changes hands MOVES to the new person", async () => {
    const config = configWith();
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
    });
    await registerDriverPushToken(config, {
      userId: bob,
      token: TOKEN_A,
      platform: "ios",
    });

    // Two rows here would mean Alice keeps hearing about Bob's pickups.
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(0);
    expect(await listDriverPushTokens(db, [bob])).toHaveLength(1);
  });

  it("refuses a token that is not Expo-shaped, before touching the table", async () => {
    await expect(
      registerDriverPushToken(configWith(), {
        userId: alice,
        token: "fcm:not-an-expo-token",
        platform: "android",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* Disable / revive                                                  */
  /* ---------------------------------------------------------------- */

  it("a disabled token drops out of the send list and a re-register revives it", async () => {
    const config = configWith();
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
    });
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_B,
      platform: "ios",
    });

    expect(await disableDriverPushTokens(db, [TOKEN_A], now)).toBe(1);
    // Already disabled: not counted twice.
    expect(await disableDriverPushTokens(db, [TOKEN_A], now)).toBe(0);
    expect((await listDriverPushTokens(db, [alice])).map((t) => t.token)).toEqual([
      TOKEN_B,
    ]);

    // The row is still there, flagged, so the app reinstalling can heal it.
    const [row] = await db
      .select()
      .from(driverPushTokens)
      .where(eq(driverPushTokens.token, TOKEN_A));
    expect(row?.disabledAt).toEqual(now);

    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
    });
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(2);
  });

  it("disables nothing when asked for nothing", async () => {
    expect(await disableDriverPushTokens(db, [])).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* Authorization                                                     */
  /* ---------------------------------------------------------------- */

  it("cannot unregister another user's token, even knowing it", async () => {
    const config = configWith();
    await registerDriverPushToken(config, {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
    });

    expect(await unregisterDriverPushToken(config, { userId: bob, token: TOKEN_A })).toBe(
      false,
    );
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(1);

    // The owner can.
    expect(
      await unregisterDriverPushToken(config, { userId: alice, token: TOKEN_A }),
    ).toBe(true);
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(0);
  });

  it("a deleted user takes their tokens with them", async () => {
    await registerDriverPushToken(configWith(), {
      userId: alice,
      token: TOKEN_A,
      platform: "ios",
    });
    await db.delete(users).where(eq(users.id, alice));
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(0);
  });

  it("targets nobody when asked for nobody", async () => {
    expect(await listDriverPushTokens(db, [])).toEqual([]);
  });
});
