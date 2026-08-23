import { fileURLToPath } from "node:url";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, otpSendLog, type Database } from "@koolee/db";

import {
  OTP_MAX_SENDS_PER_DESTINATION,
  OTP_MAX_SENDS_PER_USER,
  recordOtpSend,
} from "./otp-throttle";

/**
 * Concurrency acceptance for the OTP throttle's advisory locks — the checks a
 * fake db cannot make, because the whole point is real lock contention.
 *
 * The per-user case is the SMS-pumping vector from
 * apps/web/docs/pre-launch-security.md item 1: before the user lock, a burst of sends
 * to DIFFERENT destinations from one session never contended on any lock, so
 * every burst member could pass the count check before the first row was
 * visible — the per-user cap was soft exactly where it mattered.
 *
 * Needs only a bare Postgres (`otp_send_log` has no FK by design); runs under
 * plain `docker compose up -d` as well as the full `pnpm test:env:up` stack.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping OTP throttle concurrency tests.",
  );
}

process.env.OTP_LOG_HMAC_KEY ??= "integration-test-hmac-key-".padEnd(64, "k");

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describeIntegration("recordOtpSend under concurrency (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    // A dedicated connection per in-flight transaction, so the bursts below
    // genuinely run concurrently instead of queueing on the pool.
    db = createDb({ url: TEST_DATABASE_URL!, max: 10 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`delete from otp_send_log`);
  });

  it("holds the per-user cap across a concurrent burst to DISTINCT destinations", async () => {
    const attempts = OTP_MAX_SENDS_PER_USER + 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        recordOtpSend(db, {
          userId: uid(1),
          destination: `+1332260280${i}`,
          kind: "phone",
        }),
      ),
    );

    const allowed = results.filter((r) => r.allowed);
    expect(allowed).toHaveLength(OTP_MAX_SENDS_PER_USER);
    for (const rejected of results.filter((r) => !r.allowed)) {
      expect(rejected.reason).toBe("user_capped");
    }

    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(otpSendLog);
    expect(row?.count).toBe(OTP_MAX_SENDS_PER_USER);
  });

  it("holds the per-destination cap across a concurrent burst from DISTINCT users", async () => {
    const attempts = OTP_MAX_SENDS_PER_DESTINATION + 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        recordOtpSend(db, {
          userId: uid(100 + i),
          destination: "+13322602829",
          kind: "phone",
        }),
      ),
    );

    const allowed = results.filter((r) => r.allowed);
    expect(allowed).toHaveLength(OTP_MAX_SENDS_PER_DESTINATION);
    for (const rejected of results.filter((r) => !r.allowed)) {
      expect(rejected.reason).toBe("destination_capped");
    }

    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(otpSendLog);
    expect(row?.count).toBe(OTP_MAX_SENDS_PER_DESTINATION);
  });

  it("serializes same-user sends to the same destination (both caps intact)", async () => {
    const results = await Promise.all(
      Array.from({ length: OTP_MAX_SENDS_PER_USER + 2 }, () =>
        recordOtpSend(db, {
          userId: uid(2),
          destination: "+13322602828",
          kind: "phone",
        }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(OTP_MAX_SENDS_PER_USER);
  });
});
