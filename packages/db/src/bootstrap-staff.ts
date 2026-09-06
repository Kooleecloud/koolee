import { config as loadEnv } from "dotenv";

// Shell-first, same rule as migrate.ts / seed.ts: an inline
// `DATABASE_URL=... pnpm bootstrap:staff` must beat packages/db/.env, which
// points at LOCAL by design.
const shellDatabaseUrl = process.env.DATABASE_URL;

import { createDb } from "./client";
import { staffMembers, users } from "./schema";

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

/**
 * `pnpm bootstrap:staff` — mint the FIRST staff account on a database that
 * has none.
 *
 * Why this exists separately from `pnpm seed`: `seedLocalStaff` refuses any
 * non-local Supabase host, and that refusal is correct — it seeds a fixed
 * roster with passwords published in the source file, which on a hosted
 * project would be a standing backdoor. But a fresh hosted project is then
 * unbootstrappable: the admin console's invite flow is the only way to create
 * staff, and it requires an admin session to reach.
 *
 * This script is the deliberate one-time escape hatch, and it is safe on
 * hosted because it carries NO credentials of its own — the operator supplies
 * the email and password at the call site, so nothing about the resulting
 * account is knowable from this repository.
 *
 * It does exactly what the invite action does, minus the email round trip:
 *   1. create (or find) the GoTrue user, email already confirmed
 *   2. upsert `public.users` with the SAME id — that id equality is the join
 *   3. upsert the `staff_members` row that `requireStaffRole` reads
 *
 * Usage (values from Supabase → Project Settings → API):
 *
 *   SUPABASE_URL='https://<ref>.supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
 *   DATABASE_URL='postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:6543/postgres' \
 *   BOOTSTRAP_EMAIL='you@example.com' \
 *   BOOTSTRAP_PASSWORD='<something you choose>' \
 *   pnpm --filter @koolee/db bootstrap:staff
 *
 * Optional: BOOTSTRAP_ROLE (agent|admin, default admin), BOOTSTRAP_NAME,
 * BOOTSTRAP_CAN_DRIVE=true.
 *
 * Idempotent: re-running with the same email reactivates the row and updates
 * the role. It does NOT reset an existing password — do that from the
 * Supabase dashboard or the app's reset flow.
 */

const MIN_PASSWORD_LENGTH = 12;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set — see the usage block in this file.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("BOOTSTRAP_EMAIL").trim().toLowerCase();
  const password = required("BOOTSTRAP_PASSWORD");
  const roleInput = (process.env.BOOTSTRAP_ROLE ?? "admin").trim();
  const fullName = process.env.BOOTSTRAP_NAME?.trim() || null;
  const canDrive = process.env.BOOTSTRAP_CAN_DRIVE === "true";

  if (roleInput !== "admin" && roleInput !== "agent") {
    console.error(`BOOTSTRAP_ROLE must be 'admin' or 'agent' (got '${roleInput}').`);
    process.exit(1);
  }
  const role = roleInput;

  // The whole safety argument for allowing a hosted host here is that the
  // password is not in this repo. A short or seed-shaped one gives that away.
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    process.exit(1);
  }
  if (/^koolee-(admin|agent)-dev-\d+$/.test(password)) {
    console.error(
      "BOOTSTRAP_PASSWORD is one of the seeded local dev passwords, which are " +
        "published in seed.ts. Choose one that isn't in the repository.",
    );
    process.exit(1);
  }

  const connectionString = shellDatabaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  // Host only, never credentials — the same line migrate/seed print, for the
  // same reason: landing on the wrong database must be visible, not silent.
  console.log(`Target Supabase: ${new URL(supabaseUrl).hostname}`);
  console.log(`Target database: ${new URL(connectionString).hostname}`);
  console.log(`Creating ${email} as ${role}${canDrive ? " (can drive)" : ""}…`);

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // GoTrue admin REST directly — this package carries no supabase-js, same as
  // the seed. `email_confirm` skips the confirmation mail: there is no inbox
  // to click through on a fresh project, and hosted projects start on
  // Supabase's built-in sender, which only delivers to project members.
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  let userId: string | undefined;
  if (createRes.ok) {
    userId = ((await createRes.json()) as { id?: string }).id;
  } else {
    const body = (await createRes.json().catch(() => ({}))) as {
      error_code?: string;
      msg?: string;
    };
    const exists =
      body.error_code === "email_exists" || /already.*registered/i.test(body.msg ?? "");
    if (!exists) {
      console.error(`Auth user creation failed — ${body.msg ?? createRes.status}`);
      process.exit(1);
    }
    // Already an auth user: attach the role to it rather than failing. The
    // password is left alone — this script never overwrites a live one.
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers },
    );
    const list = (await listRes.json()) as {
      users?: Array<{ id: string; email?: string }>;
    };
    userId = list.users?.find((u) => u.email?.toLowerCase() === email)?.id;
    console.log("  auth user already existed — attaching the role, password untouched");
  }

  if (!userId) {
    console.error("Could not resolve the auth user id.");
    process.exit(1);
  }

  const db = createDb({ url: connectionString, max: 1 });

  // Mirrors createStaffMember() in @koolee/core — replicated rather than
  // imported because @koolee/db must not depend on core.
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: userId, email, fullName, role, isAnonymous: false })
      .onConflictDoUpdate({
        target: users.id,
        set: { email, role, isAnonymous: false },
      });
    await tx
      .insert(staffMembers)
      .values({ userId, role, active: true, canDrive })
      .onConflictDoUpdate({
        target: staffMembers.userId,
        set: { role, active: true, canDrive, updatedAt: new Date() },
      });
  });

  console.log(`Done. ${email} → ${role} (auth id ${userId}).`);
  console.log("Sign in at the admin app; invite the rest of the roster from /staff.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Bootstrap failed:", error);
  process.exit(1);
});
