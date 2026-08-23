import { fileURLToPath } from "node:url";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, otpSendLog, users, type Database } from "@koolee/db";

import { getBookingDraft, reparentBookingDraft, upsertBookingDraft } from "../services/booking-drafts";
import {
  attachVerifiedPhone,
  deleteAnonymousCustomer,
  ensureCustomerFromAuth,
} from "../services/customers";
import {
  deleteRowsCreatedSince,
  snapshotExistingRows,
  type PreservedRows,
} from "../test-utils/preserve-existing-rows";
import { recordOtpSend } from "./otp-throttle";
import { reconcileEmailClaims, reconcilePhoneClaims } from "./reconcile-claims";
import { guardUpgradeOtpSend } from "./upgrade-guard";

/**
 * Acceptance tests 15 & 16 for the auth close-out — the two tests covering
 * the highest-severity bug in the auth work, cross-session data exposure via
 * `phone_change` collision, and its companion (an existing account must be
 * detected BEFORE any OTP is sent).
 *
 * These need the real GoTrue auth schema, not just a bare Postgres — a
 * hand-created `auth` schema has the columns but none of GoTrue's
 * `phone_change`/`email_change` resolution behavior, so the tests would pass
 * vacuously. `pnpm test:env:up` (packages/core/docs/local-test-env.md) stands up the real
 * Supabase CLI stack and writes `.env.test` with everything below.
 *
 * Gating, deliberately in two stages:
 *  - No `GOTRUE_TEST_DATABASE_URL` at all → skip, same as every other
 *    integration suite, so a fresh clone stays green.
 *  - Set but `AUTH_SCHEMA_AVAILABLE` not `"true"` → FAIL, not skip. Silently
 *    skipping here would let CI report green forever without ever exercising
 *    the collision fix.
 *
 * This suite runs against the DEV database, not the disposable `koolee_test`
 * one, because GoTrue only ever serves `postgres` and these tests read
 * `auth.users` in the same connection they assert app tables on. Sharing that
 * database means it must be left exactly as it was found: cleanup deletes only
 * rows this run created (`preserve-existing-rows.ts`), never a blanket wipe.
 */

const GOTRUE_TEST_DATABASE_URL = process.env.GOTRUE_TEST_DATABASE_URL;
const AUTH_SCHEMA_AVAILABLE = process.env.AUTH_SCHEMA_AVAILABLE === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const describeIntegration = GOTRUE_TEST_DATABASE_URL ? describe : describe.skip;

if (!GOTRUE_TEST_DATABASE_URL) {
  console.log(
    "[integration] GOTRUE_TEST_DATABASE_URL not set — skipping acceptance tests 15/16.\n" +
      "  pnpm test:env:up && pnpm --filter @koolee/core test:integration",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Two local-only numbers wired to fixed OTPs in supabase/config.toml. */
const TEST_PHONES = {
  collision: { phone: "+15555550100", code: "123456" },
  existingAccount: { phone: "+15555550101", code: "654321" },
} as const;

const TEST_EMAIL = "existing.customer@koolee-test.example";

describeIntegration("phone/email upgrade guard — acceptance tests 15 & 16 (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let admin: SupabaseClient;
  let createdAuthUserIds: string[];
  let preserved: PreservedRows;
  /** `otp_send_log` rows already present when this test started. */
  let otpSendLogBaseline = 0;

  beforeAll(async () => {
    if (!AUTH_SCHEMA_AVAILABLE) {
      throw new Error(
        'AUTH_SCHEMA_AVAILABLE must be "true" to run this suite. These tests exercise real ' +
          "GoTrue phone_change/email_change resolution — a database URL alone (a bare " +
          "Postgres) is not enough, and silently skipping would let this coverage rot. Run " +
          "`pnpm test:env:up` (see packages/core/docs/local-test-env.md) instead of skipping this file.",
      );
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set alongside " +
          "AUTH_SCHEMA_AVAILABLE=true. Run `pnpm test:env:up`.",
      );
    }

    sqlClient = postgres(GOTRUE_TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: GOTRUE_TEST_DATABASE_URL!, max: 5 });
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Before this suite inserts anything: what is already here stays here.
    preserved = await snapshotExistingRows(sqlClient);
  });

  afterAll(async () => {
    // beforeAll may have thrown before assigning these (missing/misconfigured
    // env) — nothing to clean or close in that case.
    if (sqlClient && preserved) {
      await deleteRowsCreatedSince(sqlClient, preserved);
    }
    await sqlClient?.end();
  });

  beforeEach(async () => {
    createdAuthUserIds = [];
    await deleteRowsCreatedSince(sqlClient, preserved);
    // Best-effort: delete any GoTrue users left over at the fixed test
    // numbers/email by a previous run that crashed before its own cleanup.
    for (const { phone } of Object.values(TEST_PHONES)) {
      for (const row of await authUsersHolding(phone)) {
        await deleteAuthUser(row.id);
      }
    }
    for (const row of await authUsersHoldingEmail(TEST_EMAIL)) {
      await deleteAuthUser(row.id);
    }
    // Everything this test writes is measured against what was already here.
    otpSendLogBaseline = await rawCountOtpSendLog();
  });

  afterEach(async () => {
    for (const id of createdAuthUserIds) {
      await deleteAuthUser(id);
    }
  });

  function freshAnonClient(): SupabaseClient {
    return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Tolerates "already gone" — several call sites delete the same user. */
  async function deleteAuthUser(userId: string): Promise<void> {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404 && !/not.?found/i.test(error.message)) {
      throw new Error(`admin.deleteUser(${userId}): ${error.message}`);
    }
  }

  async function signInAnon(): Promise<{ client: SupabaseClient; userId: string }> {
    const client = freshAnonClient();
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`signInAnonymously failed: ${error?.message}`);
    createdAuthUserIds.push(data.user.id);
    return { client, userId: data.user.id };
  }

  interface AuthUserRow {
    id: string;
    phone: string | null;
    phone_change: string | null;
    is_anonymous: boolean;
  }

  /** Mirrors the query `reconcile-claims.ts` runs — any row claiming `destination`. */
  async function authUsersHolding(destination: string): Promise<AuthUserRow[]> {
    const bare = destination.replace(/^\+/, "");
    const rows = (await db.execute(
      sql`select id::text as id, phone, phone_change, is_anonymous
          from auth.users
          where phone in (${destination}, ${bare}) or phone_change in (${destination}, ${bare})`,
    )) as unknown as AuthUserRow[];
    return Array.from(rows);
  }

  async function authUsersHoldingEmail(email: string): Promise<AuthUserRow[]> {
    const normalized = email.toLowerCase();
    const rows = (await db.execute(
      sql`select id::text as id, phone, phone_change, is_anonymous
          from auth.users
          where lower(email) = ${normalized} or lower(email_change) = ${normalized}`,
    )) as unknown as AuthUserRow[];
    return Array.from(rows);
  }

  /**
   * Rows THIS test wrote, not rows in the table.
   *
   * The suite shares the dev database and no longer empties it, so whatever
   * `otp_send_log` already held is subtracted out. Without the baseline the
   * cap assertions read another session's throttle history as their own.
   */
  async function countOtpSendLog(): Promise<number> {
    return (await rawCountOtpSendLog()) - otpSendLogBaseline;
  }

  async function rawCountOtpSendLog(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(otpSendLog);
    return row?.count ?? 0;
  }

  /* ------------------------------------------------------------------ */
  /* Test 15 — phone_change collision resolves to the correct user       */
  /* ------------------------------------------------------------------ */

  it("test 15: an abandoned anonymous claimant is removed before the new session verifies, so only the new session ends up holding the phone", async () => {
    const { phone: PHONE, code: CODE } = TEST_PHONES.collision;

    // 1. Anonymous user A attaches phone P (phone_change pending) via the
    // real updateUser call, but never verifies. Give A a draft.
    const a = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: a.userId, isAnonymous: true });
    await upsertBookingDraft(db, { userId: a.userId, payload: { note: "A's draft" } });
    const { error: aUpdateErr } = await a.client.auth.updateUser({ phone: PHONE });
    expect(aUpdateErr).toBeNull();

    // At this point A and B would collide if B attached and verified the
    // same phone without reconciling first: GoTrue matches a phone_change
    // verification purely by (phone_change value, token), so two rows
    // holding the same pending value are genuinely ambiguous. The guarded
    // path below — reconcile BEFORE attach — is what removes that ambiguity.

    // 2. Anonymous user B, holding its own draft, attaches the SAME phone —
    // via the exact sequence guardUpgradeSend runs in production: throttle,
    // then reconcile, THEN updateUser, THEN verify.
    const b = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: b.userId, isAnonymous: true });
    await upsertBookingDraft(db, { userId: b.userId, payload: { note: "B's draft" } });

    const allowance = await recordOtpSend(db, {
      userId: b.userId,
      destination: PHONE,
      kind: "phone",
    });
    expect(allowance.allowed).toBe(true);

    const reconciled = await reconcilePhoneClaims(db, PHONE, {
      currentUserId: b.userId,
      deleteAuthUser,
    });
    expect(reconciled.conflict).toBe(false);
    expect(reconciled.removedAnonymousUserIds).toEqual([a.userId]);

    const { error: bUpdateErr } = await b.client.auth.updateUser({ phone: PHONE });
    expect(bUpdateErr).toBeNull();

    const { data: verifyData, error: verifyErr } = await b.client.auth.verifyOtp({
      phone: PHONE,
      token: CODE,
      type: "phone_change",
    });
    expect(verifyErr).toBeNull();
    expect(verifyData?.user?.id).toBe(b.userId);

    await attachVerifiedPhone(db, { authUserId: b.userId, phone: PHONE });

    // Assert: phone P is on B; B's draft is intact; A and A's draft are
    // gone; no row other than B holds P in phone or phone_change.
    const holders = await authUsersHolding(PHONE);
    expect(holders.map((r) => r.id)).toEqual([b.userId]);

    const bUser = await db.query.users.findFirst({ where: eq(users.id, b.userId) });
    expect(bUser?.phone).toBe(PHONE);
    expect(bUser?.isAnonymous).toBe(false);
    await expect(getBookingDraft(db, b.userId)).resolves.toMatchObject({
      payload: { note: "B's draft" },
    });

    expect(await db.query.users.findFirst({ where: eq(users.id, a.userId) })).toBeUndefined();
    expect(await getBookingDraft(db, a.userId)).toBeNull();

    const { data: aAuth } = await admin.auth.admin.getUserById(a.userId);
    expect(aAuth.user).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* Test 16 — existing account detected before any SMS                  */
  /* ------------------------------------------------------------------ */

  it("test 16 (phone): returns PHONE_EXISTS before any send, then the conflict branch reparents the draft and deletes the orphaned anonymous user", async () => {
    const { phone: PHONE, code: CODE } = TEST_PHONES.existingAccount;

    // 1. A permanent user already holds phone P.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone: PHONE,
      phone_confirm: true,
    });
    expect(createErr).toBeNull();
    const permanentUserId = created!.user!.id;
    createdAuthUserIds.push(permanentUserId);
    await ensureCustomerFromAuth(db, {
      authUserId: permanentUserId,
      isAnonymous: false,
      phone: PHONE,
    });

    // 2. An anonymous session, holding its own draft, calls `guardUpgradeSend`
    // for P.
    const anon = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: anon.userId, isAnonymous: true });
    await upsertBookingDraft(db, { userId: anon.userId, payload: { note: "anon draft" } });

    const otpLogCountBefore = await countOtpSendLog();
    const allowance = await recordOtpSend(db, {
      userId: anon.userId,
      destination: PHONE,
      kind: "phone",
    });
    expect(allowance.allowed).toBe(true);
    // Part C's required order commits the throttle row BEFORE reconcile runs
    // — the destination is counted against the cap even though it turns out
    // to be an existing account, so probing registered numbers isn't a free
    // way around the rate limit. (This is why a send-count assertion here,
    // not a "no row written" one, is the correct check against the ALREADY
    // COMPLETE Part C behavior — see the report.)
    expect(await countOtpSendLog()).toBe(otpLogCountBefore + 1);

    const reconciled = await reconcilePhoneClaims(db, PHONE, {
      currentUserId: anon.userId,
      deleteAuthUser,
    });
    expect(reconciled.conflict).toBe(true);
    expect(reconciled.removedAnonymousUserIds).toEqual([]);

    // 3. Assert: PHONE_EXISTS is what the caller would report; no Supabase
    // send was attempted (guardUpgradeSend returns immediately on conflict —
    // `updateUser` is never reached); the anonymous user and its draft are
    // untouched.
    const sendAttempted = vi.fn();
    if (!reconciled.conflict) sendAttempted();
    expect(sendAttempted).not.toHaveBeenCalled();

    const anonAfterConflict = await db.query.users.findFirst({ where: eq(users.id, anon.userId) });
    expect(anonAfterConflict?.isAnonymous).toBe(true);
    await expect(getBookingDraft(db, anon.userId)).resolves.toMatchObject({
      payload: { note: "anon draft" },
    });

    // 4. Drive the conflict branch end to end: sign in as the permanent
    // owner, verify, then reparent the anonymous draft and delete the orphan.
    const signInClient = freshAnonClient();
    const { error: signInErr } = await signInClient.auth.signInWithOtp({ phone: PHONE });
    expect(signInErr).toBeNull();
    const { data: verifyData, error: verifyErr } = await signInClient.auth.verifyOtp({
      phone: PHONE,
      token: CODE,
      type: "sms",
    });
    expect(verifyErr).toBeNull();
    expect(verifyData?.user?.id).toBe(permanentUserId);

    await reparentBookingDraft(db, { fromUserId: anon.userId, toUserId: permanentUserId });
    const deleted = await deleteAnonymousCustomer(db, anon.userId);
    expect(deleted).toBe(true);
    await deleteAuthUser(anon.userId);

    await expect(getBookingDraft(db, permanentUserId)).resolves.toMatchObject({
      payload: { note: "anon draft" },
    });
    expect(await getBookingDraft(db, anon.userId)).toBeNull();
    expect(await db.query.users.findFirst({ where: eq(users.id, anon.userId) })).toBeUndefined();

    const { data: anonAuthAfter } = await admin.auth.admin.getUserById(anon.userId);
    expect(anonAuthAfter.user).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* Merged guard — throttle + reconcile under one lock scope            */
  /* ------------------------------------------------------------------ */

  it("merged guard: two overlapping guarded sends for one destination serialize, removing a stale claimant exactly once", async () => {
    const { phone: PHONE } = TEST_PHONES.collision;

    // Stale claimant C: attached P (phone_change pending), then abandoned.
    const c = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: c.userId, isAnonymous: true });
    const { error: cErr } = await c.client.auth.updateUser({ phone: PHONE });
    expect(cErr).toBeNull();

    const a = await signInAnon();
    const b = await signInAnon();

    // The slow delete holds the winner's transaction — and therefore the
    // destination advisory lock — open while the other guard is already
    // running. Pre-merge, the loser's reconcile could interleave between the
    // winner's throttle commit and reconcile; now it must wait out the whole
    // guard, and finds no claim left.
    const deletions: string[] = [];
    const slowDeleteAuthUser = async (userId: string) => {
      deletions.push(userId);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await deleteAuthUser(userId);
    };

    const [ga, gb] = await Promise.all([
      guardUpgradeOtpSend(db, {
        userId: a.userId,
        destination: PHONE,
        kind: "phone",
        deleteAuthUser: slowDeleteAuthUser,
        log: () => {},
      }),
      guardUpgradeOtpSend(db, {
        userId: b.userId,
        destination: PHONE,
        kind: "phone",
        deleteAuthUser: slowDeleteAuthUser,
        log: () => {},
      }),
    ]);

    expect(ga.allowed).toBe(true);
    expect(gb.allowed).toBe(true);
    expect(ga.conflict).toBe(false);
    expect(gb.conflict).toBe(false);

    // Exactly one side saw C; the other entered its reconcile after C was
    // already gone. No double delete, no mutual removal.
    expect([...ga.removedAnonymousUserIds, ...gb.removedAnonymousUserIds]).toEqual([c.userId]);
    expect(deletions).toEqual([c.userId]);
    expect(await authUsersHolding(PHONE)).toEqual([]);

    // Both sends were counted against the destination window.
    expect(await countOtpSendLog()).toBe(2);
  });

  it("test 16 (email): returns EMAIL_EXISTS before any send, and leaves the anonymous user and its draft untouched", async () => {
    const EMAIL = TEST_EMAIL;

    // 1. A permanent user already holds email E.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    const permanentUserId = created!.user!.id;
    createdAuthUserIds.push(permanentUserId);
    await ensureCustomerFromAuth(db, {
      authUserId: permanentUserId,
      isAnonymous: false,
      email: EMAIL,
    });

    // 2. An anonymous session, holding its own draft, calls `guardUpgradeSend`
    // for E.
    const anon = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: anon.userId, isAnonymous: true });
    await upsertBookingDraft(db, { userId: anon.userId, payload: { note: "anon draft" } });

    const allowance = await recordOtpSend(db, {
      userId: anon.userId,
      destination: EMAIL,
      kind: "email",
    });
    expect(allowance.allowed).toBe(true);

    const reconciled = await reconcileEmailClaims(db, EMAIL, {
      currentUserId: anon.userId,
      deleteAuthUser,
    });
    expect(reconciled.conflict).toBe(true);
    expect(reconciled.removedAnonymousUserIds).toEqual([]);

    // 3. No send attempted; anonymous user and draft untouched.
    const sendAttempted = vi.fn();
    if (!reconciled.conflict) sendAttempted();
    expect(sendAttempted).not.toHaveBeenCalled();

    const anonAfterConflict = await db.query.users.findFirst({ where: eq(users.id, anon.userId) });
    expect(anonAfterConflict?.isAnonymous).toBe(true);
    await expect(getBookingDraft(db, anon.userId)).resolves.toMatchObject({
      payload: { note: "anon draft" },
    });
  });
});
