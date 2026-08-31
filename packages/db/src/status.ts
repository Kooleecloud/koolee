import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { createMigrationClient } from "./client";

/**
 * Read-only migration drift report.
 *
 * This exists because "which migrations has THAT database actually had
 * applied?" was, until now, a question you could only answer by opening a SQL
 * console — so nobody asked it, and production quietly sat ELEVEN migrations
 * behind local until a test failure surfaced it. Drift is cheap to fix while
 * it is one migration wide and expensive once it is eleven.
 *
 * Writes nothing, takes no locks, runs no DDL. Safe against production, which
 * is the whole point: a check you hesitate to run is a check you will not run.
 *
 * Target resolution is deliberately identical to migrate.ts — shell first,
 * then dotenv — so this reports on exactly the database `db:migrate` would
 * touch, not a different one that happens to be configured nearby.
 *
 * WHY THIS COMPARES HASHES AND NOT COUNTS
 *
 * The first version of this file compared `count(*)` against the number of
 * journal files. That is not sound, and on 2026-08-10 it produced a confidently
 * wrong answer about the hosted project: "Applied: 17 of 16 … this database is
 * 1 migration(s) AHEAD. Someone applied a branch you do not have." Hosted was
 * in fact in sync. The extra row was an ORPHAN — the old `otp_send_log` 0003,
 * applied and recorded before that migration was regenerated and its file
 * deleted, so the row survives with no file to match.
 *
 * The dangerous direction is the quiet one: one orphan row plus one genuinely
 * missing migration nets to "in sync — nothing pending", which is the exact
 * false clean bill this tool was written to prevent. So we ask which migrations
 * are applied, by content hash (drizzle records the sha256 of each file), and
 * report missing and orphaned rows as the different things they are.
 */

const shellDirectUrl = process.env.DIRECT_DATABASE_URL;
const shellDatabaseUrl = process.env.DATABASE_URL;

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

const connectionString =
  shellDirectUrl ??
  shellDatabaseUrl ??
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL;

const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

interface JournalEntry {
  tag: string;
  when: number;
}

interface Migration {
  tag: string;
  /** `folderMillis` — the value drizzle writes into `created_at`. */
  when: number;
  /** sha256 of the migration file's full contents, exactly as drizzle computes it. */
  hash: string;
}

function readJournal(): Migration[] {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  return journal.entries.map((entry) => {
    const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

interface MigrationRow {
  hash: string;
  created_at: string | null;
}

/** Everything the report needs, so the connection closes before we print. */
interface DbState {
  rows: MigrationRow[];
  /** Public base tables with RLS switched off. */
  rlsOff: string[];
  /** Whether the `ensure_rls` event trigger is present. */
  ensureRls: boolean;
}

function report(migrations: Migration[], state: DbState): boolean {
  const { rows } = state;
  const byHash = new Map(migrations.map((m) => [m.hash, m]));
  const appliedHashes = new Set(rows.map((r) => r.hash));

  const missing = migrations.filter((m) => !appliedHashes.has(m.hash));
  const orphans = rows.filter((r) => !byHash.has(r.hash));
  const applied = migrations.length - missing.length;

  console.log(`Applied:  ${applied} of ${migrations.length} (matched by content hash)`);

  let ok = true;

  if (missing.length > 0) {
    ok = false;
    console.log(`Pending:  ${missing.length}\n`);
    for (const m of missing) console.log(`  → ${m.tag}`);
    console.log("\nApply with: pnpm db:migrate");
  }

  if (orphans.length > 0) {
    // NOT an error. A rewritten migration leaves one of these behind forever,
    // and deleting it would be a write to production migration history for no
    // functional gain — drizzle's migrator only ever reads the NEWEST row.
    console.log(
      `\nNote: ${orphans.length} recorded migration(s) do not match any file in ` +
        `this checkout. Expected when a migration was regenerated after being ` +
        `applied; harmless, and not something to "clean up".`,
    );
    for (const o of orphans) {
      console.log(
        `  · hash ${o.hash.slice(0, 12)}…  created_at ${o.created_at ?? "null"}`,
      );
    }
  }

  /*
   * The silent-skip check.
   *
   * drizzle applies a file only when its `folderMillis` is GREATER than the
   * newest `created_at` already recorded (pg-core/dialect.js reads exactly one
   * row: `order by created_at desc limit 1`). So a migration whose timestamp
   * lands at or below that watermark is skipped FOREVER, with no error and no
   * output — which is how the 0003 rework went wrong in the first place.
   *
   * This is the check that would have caught it.
   */
  const watermark = rows.reduce((max, r) => Math.max(max, Number(r.created_at ?? 0)), 0);
  const stranded = missing.filter((m) => m.when <= watermark);

  if (stranded.length > 0) {
    ok = false;
    console.log(
      `\nSTRANDED: ${stranded.length} pending migration(s) have a timestamp at or ` +
        `below this database's watermark (${watermark}). \`pnpm db:migrate\` will ` +
        `NOT apply them and will NOT report an error:`,
    );
    for (const m of stranded) console.log(`  ✗ ${m.tag} (when=${m.when})`);
    console.log(
      "\nFix by regenerating the migration so its timestamp is newer than the " +
        "watermark — never by editing the database's journal rows.",
    );
  }

  // Asserted here because migration 0016 promises it: RLS is uniform, and a
  // database where the event trigger could not be created will silently stop
  // applying it to new tables.
  if (state.rlsOff.length > 0) {
    ok = false;
    console.log(
      `\nRLS: ${state.rlsOff.length} public table(s) have row-level security OFF, ` +
        `which migration 0016 requires to be on everywhere:`,
    );
    console.log(`  ${state.rlsOff.join(", ")}`);
    console.log(
      state.ensureRls
        ? "\nThe ensure_rls event trigger IS present, so these predate it — re-run 0016's step 1."
        : "\nThe ensure_rls event trigger is ABSENT (it needs superuser, which Supabase's " +
            "`postgres` role lacks), so new tables do not get RLS automatically here.",
    );
  } else if (!state.ensureRls) {
    console.log(
      "\nNote: RLS is on for every public table, but the ensure_rls event trigger " +
        "is absent — tables added by future migrations will not get it automatically.",
    );
  }

  if (ok && orphans.length === 0) console.log("\nIn sync — nothing pending.");
  else if (ok) console.log("\nIn sync — nothing pending (see note above).");

  return ok;
}

async function main(): Promise<void> {
  if (!connectionString) {
    console.error("No DIRECT_DATABASE_URL or DATABASE_URL resolved. Nothing to check.");
    process.exitCode = 1;
    return;
  }

  const migrations = readJournal();
  const client = createMigrationClient(connectionString);

  // Host only — never the credentials. Reporting on the wrong database is the
  // failure this line exists to make visible (same rule as migrate.ts).
  const host = new URL(connectionString).hostname;
  console.log(`Target host: ${host}`);

  let state: DbState;
  try {
    const rows = await client<MigrationRow[]>`
      select hash, created_at::text
      from drizzle.__drizzle_migrations
      order by created_at
    `;

    const rlsOff = await client<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity
        and c.relname <> '__koolee_test_database'
      order by c.relname
    `;

    const [trigger] = await client<{ present: boolean }[]>`
      select exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') as present
    `;

    state = {
      rows,
      rlsOff: rlsOff.map((r) => r.relname),
      ensureRls: trigger?.present ?? false,
    };
  } catch (error: unknown) {
    await client.end().catch(() => {});

    // ONLY these two mean "never migrated". Everything else — DNS failure,
    // refused connection, bad password — must surface as itself.
    //
    // Catching broadly here reported an unreachable host as an empty database
    // and told the operator to migrate it. That is the most dangerous thing
    // this tool could say: it turns "I cannot see the database" into "the
    // database is blank", which invites a migrate against the wrong target.
    const code = (error as { code?: string }).code;
    const missingJournal = code === "42P01" || code === "3F000";

    if (!missingJournal) {
      console.error(`\nCould not read migration state from ${host}.`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        console.error(
          `\nThat hostname did not resolve. Supabase's direct connection ` +
            `(db.<ref>.supabase.co) is IPv6-only; on an IPv4 network use the ` +
            `SESSION pooler instead — same project, port 5432, host ` +
            `aws-0-<region>.pooler.supabase.com. Dashboard → Connect → Session pooler.`,
        );
      }
      console.error("\nNothing was determined about this database.");
      process.exitCode = 1;
      return;
    }

    console.log("Applied:  0 (no drizzle.__drizzle_migrations table)");
    console.log(`Pending:  ${migrations.length}`);
    console.log("\nThis database has never been migrated. Run: pnpm db:migrate");
    process.exitCode = 1;
    return;
  }

  await client.end();

  // Non-zero so CI can gate a deploy on this without parsing the output.
  if (!report(migrations, state)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Status check failed:", error);
  process.exitCode = 1;
});
