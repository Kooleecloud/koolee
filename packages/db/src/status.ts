import { readFileSync } from "node:fs";
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
 */

const shellDirectUrl = process.env.DIRECT_DATABASE_URL;
const shellDatabaseUrl = process.env.DATABASE_URL;

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

const connectionString =
  shellDirectUrl ?? shellDatabaseUrl ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

interface JournalEntry {
  tag: string;
  when: number;
}

function journalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  // Journal order IS apply order — drizzle runs them sequentially and records
  // one row per file, so the count of rows tells us how far a database got.
  return journal.entries.map((e) => e.tag);
}

async function main(): Promise<void> {
  if (!connectionString) {
    console.error("No DIRECT_DATABASE_URL or DATABASE_URL resolved. Nothing to check.");
    process.exitCode = 1;
    return;
  }

  const tags = journalTags();
  const client = createMigrationClient(connectionString);

  // Host only — never the credentials. Reporting on the wrong database is the
  // failure this line exists to make visible (same rule as migrate.ts).
  const host = new URL(connectionString).hostname;
  console.log(`Target host: ${host}`);

  let applied: number;
  try {
    const [row] = await client<{ n: number }[]>`
      select count(*)::int as n from drizzle.__drizzle_migrations
    `;
    applied = row?.n ?? 0;
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
    console.log(`Pending:  ${tags.length}`);
    console.log("\nThis database has never been migrated. Run: pnpm db:migrate");
    process.exitCode = 1;
    return;
  }

  await client.end();

  console.log(`Applied:  ${applied} of ${tags.length}`);

  if (applied === tags.length) {
    console.log("\nIn sync — nothing pending.");
    return;
  }

  if (applied > tags.length) {
    // The database is AHEAD of the checkout: someone applied migrations from a
    // branch this one does not have. Deploying against it could hit columns
    // that exist plus constraints this code knows nothing about.
    console.log(
      `\nWARNING: this database is ${applied - tags.length} migration(s) AHEAD of the ` +
        `migrations in this checkout. Someone applied a branch you do not have. ` +
        `Pull before migrating anything.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Pending:  ${tags.length - applied}\n`);
  for (const tag of tags.slice(applied)) console.log(`  → ${tag}`);
  console.log("\nApply with: pnpm db:migrate");
  // Non-zero so CI can gate a deploy on this without parsing the output.
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Status check failed:", error);
  process.exitCode = 1;
});
