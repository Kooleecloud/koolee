import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Two jobs, both about never destroying data someone is using.
 *
 * SETUP — the load-bearing guard. Integration suites wipe their database
 * between tests. That is only safe if the database exists FOR tests, so
 * before a single test runs we ask the database itself whether it is one, by
 * looking for the `__koolee_test_database` marker table that
 * `scripts/test-env.sh` creates in `koolee_test` and nowhere else. No marker,
 * no run. This deliberately does not trust the variable name, the database
 * name, or whoever typed the command — a copied .env, a stale shell export,
 * or `npx vitest run` instead of `pnpm test` all fail closed here rather than
 * emptying the dev database. That last one is not hypothetical: it is exactly
 * how a real booking was deleted.
 *
 * TEARDOWN — belt and braces. Nothing should wipe the dev database any more
 * (the shared-database suites use `preserve-existing-rows.ts`), so this is a
 * regression net: if the seeded staff roster has gone missing anyway,
 * re-seed it rather than leave the consoles unusable.
 */

const MARKER_TABLE = "__koolee_test_database";

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * Aborts the run unless TEST_DATABASE_URL points at a database created for
 * tests. Unset is fine — the integration files skip themselves, which is what
 * keeps `pnpm test` green on a fresh clone.
 */
async function assertDisposableTestDatabase(url: string): Promise<void> {
  const remedy =
    "Run `pnpm test:env:up` to create and migrate it, which also rewrites .env.test.";

  if (!isLocal(url)) {
    throw new Error(
      `[vitest] TEST_DATABASE_URL points at a non-local host. The integration ` +
        `suites delete rows between tests and must never reach a shared or ` +
        `hosted database. Nothing was executed.`,
    );
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false });
  let marked: boolean;
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from pg_catalog.pg_tables
      where schemaname = 'public' and tablename = ${MARKER_TABLE}
    `;
    marked = (row?.n ?? 0) > 0;
  } catch (error) {
    await sql.end();
    throw new Error(
      `[vitest] could not verify TEST_DATABASE_URL is a disposable test ` +
        `database: ${error instanceof Error ? error.message : String(error)}. ${remedy}`,
      { cause: error },
    );
  }
  const database = new URL(url).pathname.replace(/^\//, "");
  await sql.end();

  if (!marked) {
    throw new Error(
      `[vitest] REFUSING TO RUN: database "${database}" has no ${MARKER_TABLE} ` +
        `marker, so it is not a disposable test database — it is very likely ` +
        `the one the dev servers and your own bookings live in. The ` +
        `integration suites delete rows between tests; nothing was executed. ` +
        `${remedy}`,
    );
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (testUrl) await assertDisposableTestDatabase(testUrl);

  return async function teardown(): Promise<void> {
    // The dev database is the one worth healing, and it is the GoTrue-backed
    // one the shared suites touch — not the disposable test database.
    const url = process.env.GOTRUE_TEST_DATABASE_URL;
    if (!url || !isLocal(url)) return;

    let needsSeed: boolean;
    try {
      const { default: postgres } = await import("postgres");
      const sql = postgres(url, { max: 1, prepare: false });
      try {
        // Leftover per-test rows can look like data, so probe for the seed's
        // own markers: the dev admin account and an active pricing rule
        // (pickup windows are virtual — there is no slot inventory anymore).
        const [adminRow] = await sql<{ n: number }[]>`
          select count(*)::int as n
          from users
          where email = 'admin@koolee.local'
        `;
        const [ruleRow] = await sql<{ n: number }[]>`
          select count(*)::int as n from pricing_rules where active
        `;
        needsSeed = (adminRow?.n ?? 0) === 0 || (ruleRow?.n ?? 0) === 0;
      } finally {
        await sql.end();
      }
    } catch {
      // Probe failed (schema missing, DB down) — a blind seed would fail
      // the same way; leave it alone.
      return;
    }
    if (!needsSeed) return;

    const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    try {
      execFileSync("pnpm", ["--filter", "@koolee/db", "seed:local"], {
        cwd: repoRoot,
        stdio: "ignore",
        timeout: 120_000,
      });
      console.log("[vitest teardown] dev roster was missing — re-seeded.");
    } catch {
      console.warn(
        "[vitest teardown] roster re-seed failed — run `pnpm seed:local` manually.",
      );
    }
  };
}
