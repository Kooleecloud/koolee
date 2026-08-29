import type { Sql } from "postgres";

/**
 * Cleanup for the integration suites that MUST share the dev database.
 *
 * Most integration files run against the isolated `koolee_test` database and
 * can wipe it freely. Three cannot: `upgrade-guard`, `staff-auth`, and
 * `booking-ownership` drive the real GoTrue API on :54321 *and* read
 * `auth.users` over SQL, and GoTrue only ever serves the `postgres` database
 * — the one the dev servers use. Splitting them across two databases would
 * have the API write to one and the assertions read the other.
 *
 * So those three share, and get this instead of `DELETE FROM <table>`:
 * snapshot which rows exist before the run, then delete only what appeared
 * since. Rows you created in the app are still there afterwards.
 *
 * Why not scope by a test-fixture email convention: `upgrade-guard` signs in
 * ANONYMOUS users, which have no email at all, so ownership cannot be read
 * off a column. Why not `created_at >= runStart`: `otp_send_log` rows are
 * inserted with a caller-supplied timestamp (`checkAndRecordOtpSend` takes
 * `now`), and these tests inject fixed clocks in the past — the predicate
 * would silently miss them. Primary keys are the one thing that is always
 * present and always distinguishes a new row from an old one.
 */

/**
 * Every table the shared-database suites clear, child-before-parent, with the
 * primary key used to tell new rows from pre-existing ones.
 *
 * Order does not strictly matter — the deletes run with FK triggers off, the
 * same mechanism the previous blanket wipes relied on (and the only way to
 * clear append-only `custody_events`) — but it is kept meaningful so the list
 * reads like the ownership graph.
 */
const CLEARED_TABLES: ReadonlyArray<readonly [table: string, key: string]> = [
  ["custody_events", "id"],
  ["agreement_acceptances", "id"],
  ["agreement_versions", "id"],
  ["passport_verifications", "id"],
  ["payment_webhook_events", "id"],
  ["payments", "id"],
  ["verification_tasks", "id"],
  ["pickup_tasks", "id"],
  ["bags", "id"],
  ["bookings", "id"],
  ["ticket_uploads", "id"],
  ["staff_members", "id"],
  ["slots", "id"],
  ["slot_blocks", "id"],
  ["airline_cutoffs", "id"],
  ["pricing_rules", "id"],
  ["addresses", "id"],
  ["booking_drafts", "id"],
  ["otp_send_log", "id"],
  ["users", "id"],
  ["airports", "code"],
];

/** Primary keys that existed before the suite started, per table. */
export type PreservedRows = ReadonlyMap<string, string[]>;

/**
 * Records what is already in the database. Call once in `beforeAll`, BEFORE
 * the suite inserts anything.
 */
export async function snapshotExistingRows(sql: Sql): Promise<PreservedRows> {
  const snapshot = new Map<string, string[]>();
  for (const [table, key] of CLEARED_TABLES) {
    const rows = await sql.unsafe<{ k: string }[]>(
      `select ${quote(key)}::text as k from ${quote(table)}`,
    );
    snapshot.set(
      table,
      rows.map((row) => row.k),
    );
  }
  return snapshot;
}

/**
 * Deletes every row that is not in `snapshot` — i.e. everything this run
 * created, and nothing that was already there. Call in `beforeEach`, where
 * the blanket `DELETE FROM` used to be.
 */
export async function deleteRowsCreatedSince(
  sql: Sql,
  snapshot: PreservedRows,
): Promise<void> {
  // FK triggers off for the duration: children and parents go in one pass,
  // and `custody_events`' append-only trigger is bypassed exactly as the
  // previous wipe did. Scoped to this session, restored below.
  await sql.unsafe(`SET session_replication_role = replica`);
  try {
    for (const [table, key] of CLEARED_TABLES) {
      const preserved = snapshot.get(table) ?? [];
      // `<> all('{}')` is true for every row, so an empty snapshot correctly
      // means "nothing pre-existed here, clear it all".
      await sql.unsafe(
        `delete from ${quote(table)} where ${quote(key)}::text <> all($1::text[])`,
        [preserved as unknown as string],
      );
    }
  } finally {
    await sql.unsafe(`SET session_replication_role = DEFAULT`);
  }
}

/** Identifiers come from the constant above, never from test input. */
function quote(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Refusing to interpolate identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}
