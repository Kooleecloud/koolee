import { fileURLToPath } from "node:url";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, users, type Database } from "@koolee/db";

import { NotAuthorizedError } from "../errors";
import {
  deleteRowsCreatedSince,
  snapshotExistingRows,
  type PreservedRows,
} from "../test-utils/preserve-existing-rows";
import {
  createStaffMember,
  getActiveStaffRole,
  listStaffMembers,
  requireStaffRole,
  setStaffMemberActive,
} from "./staff";

/**
 * Phase 2 acceptance — staff auth for the agent/admin apps.
 *
 *  - the role guard (`requireStaffRole`, wrapping the assertRole seam)
 *    blocks customers, anonymous sessions, wrong roles, and deactivated
 *    staff, and allows the matching role;
 *  - the invite path creates the auth user + role row, sends a real email
 *    (captured by Mailpit), and refuses roles outside agent/admin;
 *  - the password-reset flow works end to end through Mailpit: reset email →
 *    recovery token → verifyOtp → updateUser(password) → signInWithPassword.
 *
 * Same gating as the acceptance suite: skip without GOTRUE_TEST_DATABASE_URL,
 * fail loudly without the GoTrue stack.
 *
 * Runs against the DEV database (GoTrue only serves `postgres`), so cleanup
 * removes only rows this run created — see `preserve-existing-rows.ts`.
 */

const GOTRUE_TEST_DATABASE_URL = process.env.GOTRUE_TEST_DATABASE_URL;
const AUTH_SCHEMA_AVAILABLE = process.env.AUTH_SCHEMA_AVAILABLE === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
/** The Supabase CLI stack's Mailpit; `pnpm test:env:up` prints it. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

const describeIntegration = GOTRUE_TEST_DATABASE_URL ? describe : describe.skip;

if (!GOTRUE_TEST_DATABASE_URL) {
  console.log(
    "[integration] GOTRUE_TEST_DATABASE_URL not set — skipping staff-auth tests.\n" +
      "  pnpm test:env:up && pnpm --filter @koolee/core test:integration",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const INVITE_EMAIL = "invited.staff@koolee-test.example";
const RESET_EMAIL = "reset.staff@koolee-test.example";
const RESET_PASSWORD_OLD = "old-password-123";
const RESET_PASSWORD_NEW = "new-password-456";

describeIntegration("staff auth — role guard, invite, password reset (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let admin: SupabaseClient;
  let createdAuthUserIds: string[];
  let preserved: PreservedRows;

  beforeAll(async () => {
    if (!AUTH_SCHEMA_AVAILABLE) {
      throw new Error(
        'AUTH_SCHEMA_AVAILABLE must be "true" to run this suite — the invite and ' +
          "reset flows exercise real GoTrue + Mailpit. Run `pnpm test:env:up`.",
      );
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set. " +
          "Run `pnpm test:env:up`.",
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
    if (sqlClient && preserved) {
      await deleteRowsCreatedSince(sqlClient, preserved);
    }
    await sqlClient?.end();
  });

  beforeEach(async () => {
    createdAuthUserIds = [];
    await deleteRowsCreatedSince(sqlClient, preserved);
    for (const email of [INVITE_EMAIL, RESET_EMAIL]) {
      for (const id of await authUserIdsForEmail(email)) {
        await deleteAuthUser(id);
      }
    }
  });

  afterEach(async () => {
    for (const id of createdAuthUserIds) await deleteAuthUser(id);
  });

  async function authUserIdsForEmail(email: string): Promise<string[]> {
    const rows = (await db.execute(
      sql`select id::text as id from auth.users where lower(email) = ${email.toLowerCase()}`,
    )) as unknown as Array<{ id: string }>;
    return Array.from(rows).map((r) => r.id);
  }

  async function deleteAuthUser(userId: string): Promise<void> {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404 && !/not.?found/i.test(error.message)) {
      throw new Error(`admin.deleteUser(${userId}): ${error.message}`);
    }
  }

  function anonClient(): SupabaseClient {
    return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Latest Mailpit message to `email`, polled — SMTP delivery is async. */
  async function latestMailTo(
    email: string,
  ): Promise<{ subject: string; body: string }> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const search = await fetch(
        `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      );
      if (search.ok) {
        const data = (await search.json()) as {
          messages?: Array<{ ID: string; Subject: string }>;
        };
        const first = data.messages?.[0];
        if (first) {
          const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${first.ID}`);
          const message = (await detail.json()) as { HTML?: string; Text?: string };
          return { subject: first.Subject, body: `${message.HTML ?? ""}\n${message.Text ?? ""}` };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`No Mailpit message for ${email} within 15s`);
  }

  /* ------------------------------------------------------------------ */
  /* Role guard                                                          */
  /* ------------------------------------------------------------------ */

  it("requireStaffRole blocks customers, anonymous sessions, wrong roles, and deactivated staff — and allows the matching role", async () => {
    // A customer (verified, real account — but NOT staff).
    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551119901", role: "customer" })
      .returning();
    expect(await getActiveStaffRole(db, customer!.id)).toBeNull();
    await expect(
      requireStaffRole(db, customer!.id, ["agent"]),
    ).rejects.toThrow(NotAuthorizedError);
    await expect(
      requireStaffRole(db, customer!.id, ["admin"]),
    ).rejects.toThrow(NotAuthorizedError);

    // An anonymous funnel session (no staff row, is_anonymous).
    const [anon] = await db
      .insert(users)
      .values({ isAnonymous: true, role: "customer" })
      .returning();
    await expect(requireStaffRole(db, anon!.id, ["agent"])).rejects.toThrow(
      NotAuthorizedError,
    );

    // A user id that exists nowhere.
    await expect(
      requireStaffRole(db, "00000000-0000-4000-8000-000000000000", ["admin"]),
    ).rejects.toThrow(NotAuthorizedError);

    // Real staff: agent role passes the agent gate, fails the admin gate.
    const [agentUser] = await db
      .insert(users)
      .values({ email: "role.agent@koolee-test.example", role: "agent" })
      .returning();
    await createStaffMember(db, {
      userId: agentUser!.id,
      email: "role.agent@koolee-test.example",
      role: "agent",
    });
    await expect(requireStaffRole(db, agentUser!.id, ["agent"])).resolves.toBe("agent");
    await expect(requireStaffRole(db, agentUser!.id, ["admin"])).rejects.toThrow(
      NotAuthorizedError,
    );

    // Deactivation is immediate: same user, next check fails.
    await setStaffMemberActive(db, { userId: agentUser!.id, active: false });
    await expect(requireStaffRole(db, agentUser!.id, ["agent"])).rejects.toThrow(
      NotAuthorizedError,
    );
    expect(await getActiveStaffRole(db, agentUser!.id)).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* Invite                                                              */
  /* ------------------------------------------------------------------ */

  it("invite creates the auth user + role row, the email lands in Mailpit, and roles outside agent/admin are refused", async () => {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(INVITE_EMAIL);
    expect(error).toBeNull();
    const invitedId = data!.user!.id;
    createdAuthUserIds.push(invitedId);

    // The role row is written server-side in the same operation the admin
    // action performs — with the inviting admin recorded.
    const [inviter] = await db
      .insert(users)
      .values({ email: "the.admin@koolee-test.example", role: "admin" })
      .returning();
    const member = await createStaffMember(db, {
      userId: invitedId,
      email: INVITE_EMAIL,
      role: "agent",
      invitedByUserId: inviter!.id,
    });
    expect(member.role).toBe("agent");
    expect(member.active).toBe(true);
    expect(member.invitedByUserId).toBe(inviter!.id);

    const userRow = await db.query.users.findFirst({ where: eq(users.id, invitedId) });
    expect(userRow?.email).toBe(INVITE_EMAIL);
    expect(userRow?.role).toBe("agent");
    expect(userRow?.isAnonymous).toBe(false);

    expect(await getActiveStaffRole(db, invitedId)).toBe("agent");

    // The invite email really went out (Mailpit captured it).
    const mail = await latestMailTo(INVITE_EMAIL);
    expect(mail.body).toMatch(/invite|Invite/);

    // Role restriction: only agent/admin are assignable — ever.
    for (const bad of ["customer", "driver", "superuser"]) {
      await expect(
        createStaffMember(db, {
          userId: invitedId,
          email: INVITE_EMAIL,
          // @ts-expect-error — deliberately illegal role from "client input"
          role: bad,
        }),
      ).rejects.toThrow(NotAuthorizedError);
    }

    // Listing shows identity + role + status for the management page.
    const list = await listStaffMembers(db);
    expect(list.map((m) => m.email)).toContain(INVITE_EMAIL);
  });

  /* ------------------------------------------------------------------ */
  /* Password reset via Mailpit                                          */
  /* ------------------------------------------------------------------ */

  it("password reset round-trips through Mailpit: reset email → recovery token → new password → sign-in", async () => {
    // Existing staff account with a password.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: RESET_EMAIL,
      password: RESET_PASSWORD_OLD,
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    const staffId = created!.user!.id;
    createdAuthUserIds.push(staffId);
    await createStaffMember(db, { userId: staffId, email: RESET_EMAIL, role: "agent" });

    // 1. Request the reset (what the /login/reset form does).
    const requester = anonClient();
    const { error: resetErr } = await requester.auth.resetPasswordForEmail(RESET_EMAIL);
    expect(resetErr).toBeNull();

    // 2. The email lands in Mailpit; extract the recovery token from the link.
    const mail = await latestMailTo(RESET_EMAIL);
    const tokenMatch = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail.body);
    expect(tokenMatch, "recovery link with ?token= in the email body").toBeTruthy();
    const tokenHash = tokenMatch![1]!;

    // 3. Verify the token (what /auth/callback does) → session.
    const recoverer = anonClient();
    const { data: verified, error: verifyErr } = await recoverer.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    expect(verifyErr).toBeNull();
    expect(verified?.user?.id).toBe(staffId);

    // 4. Set the new password (what /set-password does).
    const { error: updateErr } = await recoverer.auth.updateUser({
      password: RESET_PASSWORD_NEW,
    });
    expect(updateErr).toBeNull();

    // 5. Old password no longer works; new one signs in and passes the gate.
    const oldAttempt = await anonClient().auth.signInWithPassword({
      email: RESET_EMAIL,
      password: RESET_PASSWORD_OLD,
    });
    expect(oldAttempt.error).not.toBeNull();

    const newAttempt = await anonClient().auth.signInWithPassword({
      email: RESET_EMAIL,
      password: RESET_PASSWORD_NEW,
    });
    expect(newAttempt.error).toBeNull();
    expect(newAttempt.data.user?.id).toBe(staffId);
    expect(await getActiveStaffRole(db, staffId)).toBe("agent");
  });
});
