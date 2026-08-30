import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";

import { createDb } from "./client";
import { ALL_COVERAGE_ZIPS } from "./coverage-zips";
import { agentZones, staffMembers, users } from "./schema";

/**
 * `pnpm create:staff <database-url>` — fill a database with a working staff
 * roster (2 admins + 5 agents by default).
 *
 * The bulk sibling of `bootstrap-staff.ts`. That one mints ONE account with a
 * password you choose, for a real project. This one stands up a whole dev
 * roster with GENERATED passwords, printed once at the end — which is what
 * makes it safe to point at a hosted dev database: nothing about these
 * accounts is knowable from the repository, unlike the fixed roster in
 * `seed.ts` (whose passwords are published in the source, and which therefore
 * refuses any non-local Supabase host).
 *
 * The database URL is the only positional argument. The Supabase project is
 * DERIVED from it — a Supavisor connection string carries the project ref in
 * its username (`postgres.<ref>`) — so you do not pass the same project twice
 * and cannot accidentally write app rows to one project while creating auth
 * users in another. The service-role key is the one thing that cannot be
 * derived; it comes from the environment (or `--service-key`), and for a local
 * target it is read out of the repo-root `.env.test` that `pnpm test:env:up`
 * writes.
 *
 *   SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
 *   pnpm --filter @koolee/db create:staff -- \
 *     'postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:6543/postgres'
 *
 * Flags:
 *   --admins <n>        how many admin accounts   (default 2)
 *   --agents <n>        how many agent accounts   (default 5)
 *   --domain <d>        email domain              (default koolee.local)
 *   --password <pw>     one shared password for every account instead of
 *                       generated ones (min 8 chars)
 *   --password-prefix <p>
 *                       predictable per-account passwords shaped
 *                       `<p>-admin-1`, `<p>-agent-3` — memorable for a dev
 *                       roster. Pick a prefix nobody can guess.
 *   --reset-existing    reset the password of an account that already exists
 *                       (default: leave it alone and say so)
 *   --zones             also round-robin every covered ZIP across the created
 *                       agents, so auto-assign has somebody to pick
 *   --supabase-url <u>  override the derived project URL
 *   --service-key <k>   override SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent. Re-running adds nothing and resets nothing unless you ask.
 */

/** Minimum for `--password`. GoTrue's own floor is 6; generated ones are 24. */
const MIN_PASSWORD_LENGTH = 8;

/** Minimum for `--password-prefix`. Short enough to type, long enough to vary. */
const MIN_PREFIX_LENGTH = 3;

/** Display names, so the console shows people rather than email local-parts. */
const ADMIN_NAMES = [
  "Dana Whitfield",
  "Marcus Ellery",
  "Rosa Calderon",
  "Ike Brennan",
  "Yuki Tanaka",
];
const AGENT_NAMES = [
  "Ravi Chandra",
  "Elena Marsh",
  "Tobias Nkemdi",
  "Sofia Duarte",
  "Hal Winters",
  "Amara Osei",
  "Dmitri Volkov",
  "Grace Lindqvist",
  "Omar Haddad",
  "Iris Fontaine",
];

interface Account {
  email: string;
  password: string;
  role: "admin" | "agent";
  fullName: string;
  canDrive: boolean;
}

/**
 * Every message on the cause chain, joined.
 *
 * Drizzle wraps driver errors, so the useful text ("password authentication
 * failed") sits on `error.cause`, not on the error itself — matching against
 * `String(error)` alone silently misses every case worth a tailored hint.
 */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(" | ") : String(error);
}

/** Postgres unique_violation (23505) anywhere on the cause chain. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** URL-safe, 24 chars of real entropy. Printed once, never stored here. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

function parseCount(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 50) {
    fail(`--${flag} must be a whole number between 0 and 50 (got '${raw}').`);
  }
  return n;
}

/**
 * The Supabase project URL implied by a Postgres connection string.
 *
 * Deriving beats asking: the two must describe the SAME project or the auth
 * users land in one place and the `public.users` rows pointing at them in
 * another — orphan rows that fail every sign-in, which is exactly the failure
 * this script exists to avoid reproducing.
 */
function deriveSupabaseUrl(dbUrl: URL): string | null {
  const host = dbUrl.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "http://127.0.0.1:54321";

  // Supavisor pooler (6543/5432): the project ref rides in the username.
  const pooled = /^postgres\.([a-z0-9]{16,})$/.exec(decodeURIComponent(dbUrl.username));
  if (pooled) return `https://${pooled[1]}.supabase.co`;

  // Legacy direct host: db.<ref>.supabase.co
  const direct = /^db\.([a-z0-9]{16,})\.supabase\.co$/.exec(host);
  if (direct) return `https://${direct[1]}.supabase.co`;

  return null;
}

async function main(): Promise<void> {
  // pnpm forwards the `--` separator itself, and `parseArgs` treats `--` as an
  // end-of-options terminator — leaving it in turns every flag after it into a
  // positional, so `pnpm run create:staff -- --agents 3 <url>` would read
  // "--agents" as the connection string. Drop a leading one.
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      admins: { type: "string", default: "2" },
      agents: { type: "string", default: "5" },
      domain: { type: "string", default: "koolee.local" },
      password: { type: "string" },
      "password-prefix": { type: "string" },
      "reset-existing": { type: "boolean", default: false },
      zones: { type: "boolean", default: false },
      "supabase-url": { type: "string" },
      "service-key": { type: "string" },
    },
  });

  const rawDbUrl = positionals[0] ?? process.env.DATABASE_URL;
  if (!rawDbUrl) {
    fail(
      "Pass the database URL as the first argument:\n" +
        "  pnpm --filter @koolee/db create:staff -- 'postgresql://…'",
    );
  }

  let dbUrl: URL;
  try {
    dbUrl = new URL(rawDbUrl);
  } catch {
    fail(`'${rawDbUrl}' is not a valid connection string.`);
  }

  const adminCount = parseCount(values.admins, "admins");
  const agentCount = parseCount(values.agents, "agents");
  if (adminCount + agentCount === 0) fail("Nothing to do — both counts are 0.");
  if (adminCount > ADMIN_NAMES.length || agentCount > AGENT_NAMES.length) {
    fail(
      `Name pool holds ${ADMIN_NAMES.length} admins and ${AGENT_NAMES.length} agents; ` +
        "add more to ADMIN_NAMES / AGENT_NAMES to go higher.",
    );
  }

  const sharedPassword = values.password;
  if (sharedPassword !== undefined && sharedPassword.length < MIN_PASSWORD_LENGTH) {
    fail(`--password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const prefix = values["password-prefix"];
  if (prefix !== undefined) {
    if (sharedPassword !== undefined) {
      fail("Pass either --password or --password-prefix, not both.");
    }
    if (prefix.length < MIN_PREFIX_LENGTH || /\s/.test(prefix)) {
      fail(
        `--password-prefix must be at least ${MIN_PREFIX_LENGTH} characters ` +
          "and contain no whitespace.",
      );
    }
  }

  /**
   * `dev` → `dev-admin-1`, `dev-agent-3`. Memorable beats strong for a dev
   * roster you sign into twenty times a day — but a PREDICTABLE password is
   * only as private as the pattern, and the pattern is in this file. Choosing
   * a prefix nobody can guess is what keeps it from being a standing backdoor,
   * which is why the prefix is yours to pick rather than hardcoded.
   */
  function passwordFor(role: "admin" | "agent", n: number): string {
    if (sharedPassword !== undefined) return sharedPassword;
    if (prefix !== undefined) return `${prefix}-${role}-${n}`;
    return generatePassword();
  }

  const isLocal = dbUrl.hostname === "127.0.0.1" || dbUrl.hostname === "localhost";

  const supabaseUrl = values["supabase-url"] ?? deriveSupabaseUrl(dbUrl);
  if (!supabaseUrl) {
    fail(
      `Could not work out the Supabase project from host '${dbUrl.hostname}'.\n` +
        "Pass it explicitly: --supabase-url 'https://<ref>.supabase.co'",
    );
  }

  // A local target's service key is already on disk — `pnpm test:env:up`
  // writes it — so don't make the operator go find it.
  if (isLocal && !values["service-key"] && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    loadEnv({
      path: fileURLToPath(new URL("../../../.env.test", import.meta.url)),
      quiet: true,
    });
  }
  const serviceKey = values["service-key"] ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set — creating auth users needs it.\n" +
        "Supabase → Project Settings → API → service_role. Or pass --service-key.",
    );
  }

  // Host only, never credentials — the same first line migrate/seed print.
  // A roster silently landing on the wrong project must be visible.
  console.log(`Target database: ${dbUrl.hostname}`);
  console.log(`Target Supabase: ${new URL(supabaseUrl).hostname}`);
  console.log(
    `Creating ${adminCount} admin(s) + ${agentCount} agent(s) @${values.domain}…`,
  );
  // Say it out loud rather than refusing. A guessable password on a hosted
  // project is a real exposure, but it is a DEV project and the operator asked
  // for it — the useful thing is that they cannot do it without noticing.
  if (!isLocal && (prefix !== undefined || sharedPassword !== undefined)) {
    console.log(
      "\n  ⚠  These passwords are predictable and this is not a local " +
        "database.\n     Anyone who can reach the sign-in page and guesses " +
        "the pattern is in.\n     Fine for a dev project; never do it where " +
        "real bookings live.",
    );
  }
  console.log("");

  const accounts: Account[] = [
    ...Array.from({ length: adminCount }, (_, i) => ({
      email: `admin${i + 1}@${values.domain}`,
      password: passwordFor("admin", i + 1),
      role: "admin" as const,
      fullName: ADMIN_NAMES[i]!,
      // An operator with a console is not a person with a van — same call the
      // seed makes.
      canDrive: false,
    })),
    ...Array.from({ length: agentCount }, (_, i) => ({
      email: `agent${i + 1}@${values.domain}`,
      password: passwordFor("agent", i + 1),
      role: "agent" as const,
      fullName: AGENT_NAMES[i]!,
      // Driving is a capability, not a role: every field agent gets it.
      canDrive: true,
    })),
  ];

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  /** Every auth user on the project, so an existing email resolves to its id. */
  let existingByEmail: Map<string, string> | null = null;
  async function findAuthUser(email: string): Promise<string | undefined> {
    if (!existingByEmail) {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
        headers,
      });
      const body = (await res.json()) as {
        users?: Array<{ id: string; email?: string }>;
      };
      existingByEmail = new Map(
        (body.users ?? [])
          .filter((u): u is { id: string; email: string } => Boolean(u.email))
          .map((u) => [u.email.toLowerCase(), u.id]),
      );
    }
    return existingByEmail.get(email);
  }

  const db = createDb({ url: rawDbUrl, max: 1 });

  // Prove the database is reachable and writable BEFORE creating a single auth
  // user. Creating auth users first and discovering the DB is unreachable on
  // the first insert leaves an account in GoTrue with no `staff_members` row
  // and — when the passwords were generated rather than derived from a prefix
  // — no record of its password anywhere, because the credential block only
  // prints accounts whose rows actually landed. Worse, grinding through the
  // whole roster against a bad credential trips Supavisor's circuit breaker
  // and locks you out of the project for a few minutes. One cheap query up
  // front turns all of that into a clean early exit.
  try {
    await db.select({ role: staffMembers.role }).from(staffMembers).limit(1);
  } catch (error) {
    const message = messageChain(error);
    console.error("\nCannot reach the database — nothing was created.\n");
    if (/password authentication failed/i.test(message)) {
      console.error(
        "  The password in the connection string was rejected. Two usual causes:\n" +
          "    · it was rotated in the dashboard and your .env still has the old one\n" +
          "    · it contains characters that must be percent-encoded in a URL\n" +
          "      (@ → %40, # → %23, / → %2F, : → %3A, + → %2B, ? → %3F)\n" +
          "  Supabase → Project Settings → Database → Connect.",
      );
    } else if (/ECIRCUITBREAKER/i.test(message)) {
      console.error(
        "  Supavisor has temporarily blocked new connections after repeated\n" +
          "  authentication failures. Fix the password, wait a minute or two,\n" +
          "  then try again.",
      );
    } else if (/relation .*staff_members.* does not exist/i.test(message)) {
      console.error(
        "  `staff_members` does not exist on this database. Run `pnpm db:migrate`\n" +
          "  against it first.",
      );
    } else {
      console.error(`  ${message}`);
    }
    process.exit(1);
  }
  const created: Account[] = [];
  const reused: Account[] = [];
  const agentUserIds: string[] = [];
  const emailCollisions: string[] = [];
  let failures = 0;

  for (const account of accounts) {
    // GoTrue admin REST directly — this package carries no supabase-js, same
    // as seed.ts. `email_confirm` skips the confirmation mail: a hosted
    // project starts on Supabase's built-in sender, which only delivers to
    // project members, so an unconfirmed roster would be a dead roster.
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        email_confirm: true,
      }),
    });

    let userId: string | undefined;
    let wasExisting = false;

    if (res.ok) {
      userId = ((await res.json()) as { id?: string }).id;
    } else {
      const body = (await res.json().catch(() => ({}))) as {
        error_code?: string;
        msg?: string;
      };
      const exists =
        body.error_code === "email_exists" || /already.*registered/i.test(body.msg ?? "");
      if (!exists) {
        console.warn(`  ${account.email}: FAILED — ${body.msg ?? res.status}`);
        failures += 1;
        continue;
      }
      wasExisting = true;
      userId = await findAuthUser(account.email);
      if (userId && values["reset-existing"]) {
        const put = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ password: account.password }),
        });
        if (!put.ok) {
          console.warn(`  ${account.email}: password reset failed — ${put.status}`);
          failures += 1;
          continue;
        }
        wasExisting = false; // its password is the one printed below
      }
    }

    if (!userId) {
      console.warn(`  ${account.email}: could not resolve auth user id`);
      failures += 1;
      continue;
    }

    // The auth id IS the app id — that equality is the only join between
    // `auth.users` and `public.users`. Copying app rows between databases
    // without it is what produces accounts that can never sign in.
    //
    // Both rows go in ONE transaction on purpose: a `public.users` row without
    // its `staff_members` partner is an account that signs in and then gets
    // refused by every page, which is the most confusing possible half-state.
    // `users.role` is NOT the authorization boundary — `requireStaffRole`
    // reads `staff_members` and nothing else.
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values({
            id: userId,
            email: account.email,
            fullName: account.fullName,
            role: account.role,
            isAnonymous: false,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              email: account.email,
              fullName: account.fullName,
              role: account.role,
              isAnonymous: false,
            },
          });
        await tx
          .insert(staffMembers)
          .values({
            userId,
            role: account.role,
            active: true,
            canDrive: account.canDrive,
          })
          .onConflictDoUpdate({
            target: staffMembers.userId,
            set: {
              role: account.role,
              active: true,
              canDrive: account.canDrive,
              updatedAt: new Date(),
            },
          });
      });
    } catch (error) {
      // The conflict target above is `users.id`, but `users.email` carries its
      // OWN unique index. A leftover row holding this email under a DIFFERENT
      // id — exactly what a hand-copied `public.users` export leaves behind —
      // is therefore an unhandled unique violation, and it aborts the whole
      // transaction: the auth user was created a moment ago, but NEITHER app
      // row lands. That is how you end up with an account that signs in and
      // has no role. Report it per account and keep going.
      failures += 1;
      if (isUniqueViolation(error)) {
        console.warn(
          `  ${account.email}: FAILED — another public.users row already holds ` +
            "this email under a different id (an auth user was created).",
        );
        emailCollisions.push(account.email);
        continue;
      }
      // Not a data collision, so it is infrastructure: the connection dropped,
      // the pooler cut us off, the credential stopped working. Carrying on
      // would mint more auth users that can never receive their rows — and
      // repeated failed connections are what trips Supavisor's circuit
      // breaker. Stop at the first one.
      console.warn(`  ${account.email}: FAILED — ${String(error)}`);
      console.warn("  Stopping — that is a connection failure, not a data one.");
      break;
    }

    if (account.role === "agent") agentUserIds.push(userId);
    if (wasExisting) reused.push(account);
    else created.push(account);
    console.log(
      `  ${account.email} → ${account.role}` +
        `${account.canDrive ? " (can drive)" : ""}` +
        `${wasExisting ? " — already existed, password unchanged" : ""}`,
    );
  }

  // Without a zone an agent is invisible to auto-assign, so a roster created
  // for testing dispatch is only half a roster. Opt-in, because it REPLACES
  // these agents' zones wholesale and that is not something to do by surprise.
  if (values.zones && agentUserIds.length > 0) {
    const zips = [...ALL_COVERAGE_ZIPS].sort();
    await db.delete(agentZones).where(inArray(agentZones.agentUserId, agentUserIds));
    await db
      .insert(agentZones)
      .values(
        zips.map((zip, i) => ({
          agentUserId: agentUserIds[i % agentUserIds.length]!,
          zip,
        })),
      )
      .onConflictDoNothing();
    console.log(
      `\n  agent zones: ${zips.length} ZIPs round-robined across ${agentUserIds.length} agents`,
    );
  }

  if (created.length > 0) {
    console.log("\n" + "─".repeat(64));
    console.log(
      prefix !== undefined || sharedPassword !== undefined
        ? "CREDENTIALS"
        : "CREDENTIALS — shown once, not stored anywhere. Save them now.",
    );
    console.log("─".repeat(64));
    for (const a of created) {
      console.log(`  ${a.role.padEnd(5)}  ${a.email.padEnd(28)}  ${a.password}`);
    }
    console.log("─".repeat(64));
  }
  if (reused.length > 0) {
    console.log(
      `\n${reused.length} account(s) already existed and were left with their ` +
        "current password. Re-run with --reset-existing to change them.",
    );
  }

  if (emailCollisions.length > 0) {
    console.log(
      "\nThose failures are stale `public.users` rows — almost always the " +
        "residue of a hand-copied export, whose ids point at auth users that " +
        "do not exist here. Inspect them, and once you are sure they are " +
        "orphans, remove them and re-run:\n\n" +
        "  select u.id, u.email, u.role\n" +
        "    from public.users u\n" +
        "    left join auth.users a on a.id = u.id\n" +
        `   where u.email in (${emailCollisions.map((e) => `'${e}'`).join(", ")})\n` +
        "     and a.id is null;\n\n" +
        "Deleting a users row CASCADES to its bookings and addresses — read " +
        "the rows before you delete them. Or sidestep it: --domain <other>.",
    );
  }

  // Read the roster back rather than trusting the writes above. `staff_members`
  // is the ONLY table the app's authorization consults, so "did the row land"
  // is the single question worth answering at the end of a run — and it is the
  // question a half-failed transaction would otherwise leave open.
  try {
    const roster = await db
      .select({
        email: users.email,
        role: staffMembers.role,
        active: staffMembers.active,
        canDrive: staffMembers.canDrive,
      })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .orderBy(staffMembers.createdAt);

    console.log(`\nstaff_members now holds ${roster.length} row(s):`);
    for (const r of roster) {
      console.log(
        `  ${(r.role ?? "?").padEnd(5)}  ${(r.email ?? "(no email)").padEnd(28)}` +
          `  active=${r.active}  can_drive=${r.canDrive}`,
      );
    }
    console.log(
      "\nThat table is the authorization boundary: an account with no active " +
        "row here is refused by every admin and agent page, whatever " +
        "`users.role` says.",
    );
  } catch {
    // A verification step must never be the thing that crashes the run — the
    // per-account results above are already printed and are what matter.
    console.log("\nCould not read staff_members back; see the failures above.");
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("create:staff failed:", error);
  process.exit(1);
});
