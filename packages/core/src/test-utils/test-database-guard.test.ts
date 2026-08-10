import { afterEach, describe, expect, it } from "vitest";

import globalSetup from "../../vitest.global-setup";

/**
 * Coverage for the guard that stands between the integration suites and the
 * database real bookings live in. It exists because the failure it prevents
 * already happened once: a bare `npx vitest run` pointed at the dev database
 * deleted a customer's booking.
 *
 * Only the branches that need no database are exercised here — a live
 * connection is the integration tier's job, and this file runs in the unit
 * tier, which must stay green on a fresh clone.
 */

const original = process.env.TEST_DATABASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = original;
});

describe("integration test-database guard", () => {
  it("does nothing when TEST_DATABASE_URL is unset, so a fresh clone stays green", async () => {
    delete process.env.TEST_DATABASE_URL;
    await expect(globalSetup()).resolves.toBeInstanceOf(Function);
  });

  it("refuses a non-local host before opening a connection", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:pw@db.example.supabase.co:5432/postgres";
    await expect(globalSetup()).rejects.toThrow(/non-local host/i);
  });

  it("refuses a hosted pooler URL too", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres.abc:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres";
    await expect(globalSetup()).rejects.toThrow(/non-local host/i);
  });
});
