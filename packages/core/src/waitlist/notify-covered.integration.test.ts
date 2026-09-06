import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, waitlistSignups, type Database } from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { RecordingNotifier, type EmailMessage } from "../notifications/notifier";
import { FakePaymentProvider } from "../payments/fake";
import { notifyNewlyCoveredWaitlist } from "./notify-covered";

/**
 * The zone-opened sweep's idempotency contract against a real table:
 * `notified_at IS NULL` is the work queue, stamps come only after a
 * successful send, failures stay queued, uncovered ZIPs wait untouched.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping waitlist notify tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Throws on selected recipients, records the rest. */
class FlakyNotifier extends RecordingNotifier {
  constructor(private readonly failFor: Set<string>) {
    super();
  }

  override sendEmail(message: EmailMessage): Promise<void> {
    if (this.failFor.has(message.to)) {
      return Promise.reject(new Error(`refused send to ${message.to}`));
    }
    return super.sendEmail(message);
  }
}

describeIntegration("notifyNewlyCoveredWaitlist (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let notifier: RecordingNotifier;
  let config: CoreConfig;

  const now = new Date("2026-08-23T14:00:00Z");

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
    notifier = new RecordingNotifier();
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      notifier,
      clock: fixedClock(now),
    });
  });

  async function insertSignup(
    email: string,
    zip: string,
    notifiedAt: Date | null = null,
  ) {
    const [row] = await db
      .insert(waitlistSignups)
      .values({ email, zip, source: "waitlist_page", notifiedAt })
      .returning();
    return row!;
  }

  it("emails covered signups, stamps them, and leaves uncovered ones queued", async () => {
    const covered = await insertSignup("in@example.com", "10001"); // Manhattan
    const uncovered = await insertSignup("out@example.com", "90210"); // LA — not covered

    const result = await notifyNewlyCoveredWaitlist(config, {
      appOrigin: "https://koolee.test/",
    });

    expect(result).toEqual({ notified: 1, failed: 0, stillUncovered: 1 });
    expect(notifier.emails).toHaveLength(1);
    expect(notifier.emails[0]).toMatchObject({ to: "in@example.com" });
    expect(notifier.emails[0]!.subject).toContain("10001");
    expect(notifier.emails[0]!.body).toContain("https://koolee.test/book");

    const [coveredRow] = await db
      .select()
      .from(waitlistSignups)
      .where(eq(waitlistSignups.id, covered.id));
    expect(coveredRow?.notifiedAt?.toISOString()).toBe(now.toISOString());

    const [uncoveredRow] = await db
      .select()
      .from(waitlistSignups)
      .where(eq(waitlistSignups.id, uncovered.id));
    expect(uncoveredRow?.notifiedAt).toBeNull();
  });

  it("never re-emails a stamped row — the sweep is idempotent", async () => {
    await insertSignup("done@example.com", "10001", new Date("2026-08-01T00:00:00Z"));

    const result = await notifyNewlyCoveredWaitlist(config);

    expect(result).toEqual({ notified: 0, failed: 0, stillUncovered: 0 });
    expect(notifier.emails).toHaveLength(0);
  });

  it("a failed send stays queued for the next sweep and never blocks the batch", async () => {
    await insertSignup("bad@example.com", "10001");
    await insertSignup("good@example.com", "11201");

    const flaky = new FlakyNotifier(new Set(["bad@example.com"]));
    const flakyConfig = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      notifier: flaky,
      clock: fixedClock(now),
    });

    const first = await notifyNewlyCoveredWaitlist(flakyConfig);
    expect(first).toEqual({ notified: 1, failed: 1, stillUncovered: 0 });
    expect(flaky.emails.map((e) => e.to)).toEqual(["good@example.com"]);

    // Next sweep (notifier healthy again) picks up ONLY the failed row.
    const second = await notifyNewlyCoveredWaitlist(config);
    expect(second).toEqual({ notified: 1, failed: 0, stillUncovered: 0 });
    expect(notifier.emails.map((e) => e.to)).toEqual(["bad@example.com"]);
  });
});
