import { fileURLToPath } from "node:url";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, waitlistSignups, type Database } from "@koolee/db";

import { InvalidInputError } from "../errors";
import { recordWaitlistSignup } from "./record-signup";

/**
 * The upsert semantics a fake db cannot prove: the (email, zip) unique pair
 * plus ON CONFLICT DO NOTHING is what makes re-submission idempotent, and
 * that behavior lives in Postgres, not in our code.
 *
 * Needs only a bare Postgres; runs under plain `docker compose up -d` as well
 * as the full `pnpm test:env:up` stack.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping waitlist signup tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

describeIntegration("recordWaitlistSignup (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 2 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`delete from waitlist_signups`);
  });

  it("persists a new signup", async () => {
    const result = await recordWaitlistSignup(db, {
      email: "traveler@example.com",
      zip: "10701",
      source: "waitlist_page",
    });
    expect(result.created).toBe(true);

    const rows = await db.select().from(waitlistSignups);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "traveler@example.com",
      zip: "10701",
      source: "waitlist_page",
      notifiedAt: null,
    });
  });

  it("is idempotent for a repeated (email, zip) pair", async () => {
    const input = {
      email: "traveler@example.com",
      zip: "10701",
      source: "booking_out_of_area",
    } as const;

    const first = await recordWaitlistSignup(db, input);
    const second = await recordWaitlistSignup(db, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await db.select().from(waitlistSignups)).toHaveLength(1);
  });

  it("lowercases email so the unique pair is case-insensitive", async () => {
    await recordWaitlistSignup(db, {
      email: "Traveler@Example.COM",
      zip: "10701",
      source: "waitlist_page",
    });
    const repeat = await recordWaitlistSignup(db, {
      email: "traveler@example.com",
      zip: "10701",
      source: "waitlist_page",
    });

    expect(repeat.created).toBe(false);
    const rows = await db.select().from(waitlistSignups);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("traveler@example.com");
  });

  it("records the same email against a second zip as a new demand signal", async () => {
    await recordWaitlistSignup(db, {
      email: "traveler@example.com",
      zip: "10701",
      source: "waitlist_page",
    });
    const second = await recordWaitlistSignup(db, {
      email: "traveler@example.com",
      zip: "10583",
      source: "waitlist_page",
    });

    expect(second.created).toBe(true);
    expect(await db.select().from(waitlistSignups)).toHaveLength(2);
  });

  it("rejects malformed input before touching the table", async () => {
    await expect(
      recordWaitlistSignup(db, {
        email: "not-an-email",
        zip: "10701",
        source: "waitlist_page",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);

    await expect(
      recordWaitlistSignup(db, {
        email: "traveler@example.com",
        zip: "1070",
        source: "waitlist_page",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(await db.select().from(waitlistSignups)).toHaveLength(0);
  });
});
