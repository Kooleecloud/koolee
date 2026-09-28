import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  driverPushTokens,
  pushSubscriptions,
  staffMembers,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import {
  RecordingExpoPushSender,
  RecordingPushSender,
  type ExpoPushSendResult,
  type PushSendResult,
  type PushTarget,
} from "../notifications/push";
import { FakePaymentProvider } from "../payments/fake";
import { listDriverPushTokens, registerDriverPushToken } from "./driver-push-tokens";
import {
  deletePushSubscription,
  listAdminPushTargets,
  listPushSubscriptionsForUser,
  listPushTargets,
  markPushSubscriptionVerified,
  pushToUsers,
  savePushSubscription,
} from "./push-subscriptions";

/**
 * F3 Phase 2 acceptance — subscription storage, authorization, and fan-out.
 *
 * The two properties that need a real database:
 *  - the unique index is on `endpoint` ALONE, so a device that changes hands
 *    MOVES rather than duplicating. Get that wrong and the previous owner
 *    keeps receiving notifications about somebody else's bags.
 *  - every write is scoped by `user_id` as well as `endpoint`, so knowing an
 *    endpoint (a value that travels through logs and proxies) is not enough
 *    to silence or hijack somebody's device.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping push-subscription tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Refuses everything, the way a dead push provider does. */
class ThrowingPushSender extends RecordingPushSender {
  override send(): Promise<PushSendResult> {
    return Promise.reject(new Error("push service unreachable"));
  }
}

/** Reports every target as gone, so the prune path is exercised. */
class ExpiringPushSender extends RecordingPushSender {
  override send(targets: PushTarget[]): Promise<PushSendResult> {
    return Promise.resolve({
      sent: 0,
      failed: targets.length,
      expired: targets.map((t) => t.id),
    });
  }
}

/** The Expo relay, dead. */
class ThrowingExpoPushSender extends RecordingExpoPushSender {
  override send(): Promise<ExpoPushSendResult> {
    return Promise.reject(new Error("exp.host unreachable"));
  }
}

/** Every token answered `DeviceNotRegistered`, so the disable path runs. */
class UnregisteredExpoPushSender extends RecordingExpoPushSender {
  override send(tokens: readonly string[]): Promise<ExpoPushSendResult> {
    return Promise.resolve({ sent: 0, failed: tokens.length, invalid: [...tokens] });
  }
}

const NOTHING = {
  targeted: 0,
  sent: 0,
  failed: 0,
  pruned: 0,
  expoSent: 0,
  expoFailed: 0,
  expoDisabled: 0,
};

const EXPO_TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

describeIntegration("push subscriptions (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  const now = new Date("2026-06-10T10:00:00Z");
  let alice: string;
  let bob: string;
  let adminId: string;

  function configWith(
    sender = new RecordingPushSender(),
    expoSender = new RecordingExpoPushSender(),
  ): CoreConfig {
    return createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      pushSender: sender,
      expoPushSender: expoSender,
      clock: fixedClock(now),
    });
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
      DELETE FROM push_subscriptions;
      DELETE FROM driver_push_tokens;
      DELETE FROM staff_members;
      DELETE FROM users;
      SET session_replication_role = DEFAULT;
    `);

    const inserted = await db
      .insert(users)
      .values([
        { phone: "+15551160001", role: "customer" },
        { phone: "+15551160002", role: "customer" },
        { email: "push.admin@koolee-test.example", role: "admin" },
      ])
      .returning({ id: users.id });
    alice = inserted[0]!.id;
    bob = inserted[1]!.id;
    adminId = inserted[2]!.id;
    await db
      .insert(staffMembers)
      .values({ userId: adminId, role: "admin", active: true });
  });

  const sub = (endpoint: string) => ({
    endpoint: `https://push.example/${endpoint}`,
    p256dh: `p256dh-${endpoint}`,
    auth: `auth-${endpoint}`,
  });

  /* ---------------------------------------------------------------- */
  /* Upsert semantics                                                  */
  /* ---------------------------------------------------------------- */

  it("stores one row per device, and one person may have several", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("phone") });

    const mine = await listPushSubscriptionsForUser(db, alice);
    expect(mine).toHaveLength(2);
    expect(await listPushTargets(db, [alice])).toHaveLength(2);
  });

  it("re-subscribing the same device UPDATES rather than duplicating", async () => {
    const config = configWith();
    const first = await savePushSubscription(config, {
      userId: alice,
      app: "agent",
      ...sub("laptop"),
      label: "Chrome",
    });

    // What `pushsubscriptionchange` posts: same endpoint, rotated keys.
    const second = await savePushSubscription(config, {
      userId: alice,
      app: "agent",
      endpoint: sub("laptop").endpoint,
      p256dh: "rotated-p256dh",
      auth: "rotated-auth",
      label: "Chrome (installed)",
    });

    expect(second.id).toBe(first.id);
    const [row] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, first.id));
    expect(row).toMatchObject({
      p256dh: "rotated-p256dh",
      auth: "rotated-auth",
      label: "Chrome (installed)",
    });
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(1);
  });

  it("a device that changes hands MOVES to the new person", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("shared") });
    await savePushSubscription(config, { userId: bob, app: "agent", ...sub("shared") });

    // The whole reason the unique index is on `endpoint` alone: two rows here
    // would mean Alice keeps being notified about Bob's bookings.
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(0);
    expect(await listPushSubscriptionsForUser(db, bob)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /* Authorization                                                     */
  /* ---------------------------------------------------------------- */

  it("cannot delete another user's subscription, even knowing the endpoint", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });

    const stolen = await deletePushSubscription(config, {
      userId: bob,
      endpoint: sub("laptop").endpoint,
    });

    expect(stolen).toBe(false);
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(1);

    // The owner can.
    expect(
      await deletePushSubscription(config, {
        userId: alice,
        endpoint: sub("laptop").endpoint,
      }),
    ).toBe(true);
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(0);
  });

  it("cannot mark another user's subscription verified", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });

    expect(
      await markPushSubscriptionVerified(config, {
        userId: bob,
        endpoint: sub("laptop").endpoint,
      }),
    ).toBe(false);
    expect((await listPushSubscriptionsForUser(db, alice))[0]?.verifiedAt).toBeNull();

    expect(
      await markPushSubscriptionVerified(config, {
        userId: alice,
        endpoint: sub("laptop").endpoint,
      }),
    ).toBe(true);
    expect((await listPushSubscriptionsForUser(db, alice))[0]?.verifiedAt).not.toBeNull();
  });

  it("a deleted user takes their subscriptions with them", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });
    await db.delete(users).where(eq(users.id, alice));
    expect(await listPushTargets(db, [alice])).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* Audiences                                                         */
  /* ---------------------------------------------------------------- */

  it("the ops audience is DERIVED from active admin staff, not a roster", async () => {
    const config = configWith();
    await savePushSubscription(config, { userId: adminId, app: "admin", ...sub("ops") });
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });

    expect(await listAdminPushTargets(db)).toHaveLength(1);

    // Deactivating the admin removes them from the audience immediately —
    // nothing to keep in step, because nothing was written down twice.
    await db
      .update(staffMembers)
      .set({ active: false })
      .where(eq(staffMembers.userId, adminId));
    expect(await listAdminPushTargets(db)).toHaveLength(0);
  });

  it("targets nobody when asked for nobody", async () => {
    expect(await listPushTargets(db, [])).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* Fan-out                                                           */
  /* ---------------------------------------------------------------- */

  it("sends to every device of every named person", async () => {
    const sender = new RecordingPushSender();
    const config = configWith(sender);
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("phone") });
    await savePushSubscription(config, { userId: bob, app: "agent", ...sub("bobs") });

    const result = await pushToUsers(
      config,
      [alice, bob],
      { title: "New visit", body: "KOO-7H2QM", tag: "task:t-1" },
      { urgency: "high" },
    );

    expect(result).toEqual({ ...NOTHING, targeted: 3, sent: 3 });
    expect(sender.sends).toHaveLength(1);
    expect(sender.sends[0]!.urgency).toBe("high");
  });

  it("prunes what the push service says is gone", async () => {
    const config = configWith(new ExpiringPushSender());
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("dead") });

    const result = await pushToUsers(config, [alice], {
      title: "x",
      body: "y",
      tag: "t",
    });

    expect(result.pruned).toBe(1);
    // A dead endpoint that is never pruned is a permanent "subscribed" in the
    // UI that will never ring again.
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(0);
  });

  it("a THROWING sender is swallowed — push is never load-bearing", async () => {
    const config = configWith(new ThrowingPushSender());
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });

    await expect(
      pushToUsers(config, [alice], { title: "x", body: "y", tag: "t" }),
    ).resolves.toEqual({ ...NOTHING, targeted: 1, failed: 1 });

    // And it did NOT prune: a provider outage must not unsubscribe anyone.
    expect(await listPushSubscriptionsForUser(db, alice)).toHaveLength(1);
  });

  it("sends nothing, and calls nothing, when nobody is subscribed", async () => {
    const sender = new RecordingPushSender();
    const config = configWith(sender);

    const result = await pushToUsers(config, [alice], {
      title: "x",
      body: "y",
      tag: "t",
    });

    expect(result).toEqual(NOTHING);
    expect(sender.sends).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* Fan-out — the Expo channel                                        */
  /* ---------------------------------------------------------------- */

  it("reaches a driver's native app AND their browser in one call", async () => {
    const web = new RecordingPushSender();
    const expo = new RecordingExpoPushSender();
    const config = configWith(web, expo);
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });
    await registerDriverPushToken(config, {
      userId: alice,
      token: EXPO_TOKEN,
      platform: "ios",
    });
    // Bob holds only a phone. He still counts.
    await registerDriverPushToken(config, {
      userId: bob,
      token: "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]",
      platform: "android",
    });

    const result = await pushToUsers(
      config,
      [alice, bob],
      { title: "New pickup on your shift", body: "KOO-7H2QM", tag: "pickup-task:t-1" },
      { urgency: "high" },
    );

    expect(result).toEqual({ ...NOTHING, targeted: 3, sent: 1, expoSent: 2 });
    expect(web.sends).toHaveLength(1);
    expect(expo.sends).toHaveLength(1);
    expect(expo.sends[0]!.tokens.sort()).toEqual([
      EXPO_TOKEN,
      "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]",
    ]);
    // Same payload, same urgency, on both channels.
    expect(expo.sends[0]!.payload).toEqual(web.sends[0]!.payload);
    expect(expo.sends[0]!.urgency).toBe("high");
  });

  it("disables what Expo says is unregistered — the row stays", async () => {
    const config = configWith(
      new RecordingPushSender(),
      new UnregisteredExpoPushSender(),
    );
    await registerDriverPushToken(config, {
      userId: alice,
      token: EXPO_TOKEN,
      platform: "ios",
    });

    const result = await pushToUsers(config, [alice], {
      title: "x",
      body: "y",
      tag: "t",
    });

    expect(result).toEqual({ ...NOTHING, targeted: 1, expoFailed: 1, expoDisabled: 1 });
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(0);
    // Disabled, not gone: the same install re-registering revives it.
    expect(await db.select().from(driverPushTokens)).toHaveLength(1);

    // And a second send finds nothing to disable, or to send to.
    expect(
      await pushToUsers(config, [alice], { title: "x", body: "y", tag: "t" }),
    ).toEqual(NOTHING);
  });

  it("a THROWING Expo relay is swallowed, and the web channel still rings", async () => {
    const web = new RecordingPushSender();
    const config = configWith(web, new ThrowingExpoPushSender());
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });
    await registerDriverPushToken(config, {
      userId: alice,
      token: EXPO_TOKEN,
      platform: "ios",
    });

    await expect(
      pushToUsers(config, [alice], { title: "x", body: "y", tag: "t" }),
    ).resolves.toEqual({ ...NOTHING, targeted: 2, sent: 1, expoFailed: 1 });

    expect(web.sends).toHaveLength(1);
    // A relay outage must not disable anyone.
    expect(await listDriverPushTokens(db, [alice])).toHaveLength(1);
  });

  it("calls the Expo sender not at all when nobody holds a token", async () => {
    const expo = new RecordingExpoPushSender();
    const config = configWith(new RecordingPushSender(), expo);
    await savePushSubscription(config, { userId: alice, app: "agent", ...sub("laptop") });

    const result = await pushToUsers(config, [alice], {
      title: "x",
      body: "y",
      tag: "t",
    });

    expect(result).toEqual({ ...NOTHING, targeted: 1, sent: 1 });
    expect(expo.sends).toHaveLength(0);
  });
});
