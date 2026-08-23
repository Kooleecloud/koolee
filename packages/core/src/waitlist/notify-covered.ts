import { isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { waitlistSignups } from "@koolee/db";

import type { CoreConfig } from "../config";
import { isInCoverage } from "../coverage/nyc-zips";
import { buildZoneOpenedEmail } from "../notifications/emails";

/**
 * The waitlist's promised email: "the message that says you're covered."
 *
 * Coverage lives in CODE (`@koolee/db/coverage-zips`), so "a zone opened" is
 * a deploy, not a database event — which is why this is a reconciling sweep
 * rather than a trigger: scan unnotified signups, email the ones whose ZIP
 * is covered NOW, stamp `notified_at` on success. Runs from a daily cron
 * (jobs/functions.ts), idempotent by construction:
 *  - `notified_at IS NULL` is the work queue; stamping removes a row from it;
 *  - a failed send leaves the stamp NULL, so the next sweep retries it;
 *  - rows for still-uncovered ZIPs are skipped untouched and picked up by
 *    whichever future deploy covers them.
 *
 * One email per (email, zip) ROW on purpose: a person waiting on two zones
 * hears about each zone when it opens — they are different facts.
 */

export interface NotifyNewlyCoveredOptions {
  /** Absolute app origin for the booking CTA. Omitted → no link. */
  appOrigin?: string | undefined;
  /** Rows examined per sweep — bounds one run's email blast. */
  batchLimit?: number;
  /** Injectable for tests. */
  now?: Date;
}

export interface NotifyNewlyCoveredResult {
  /** Emails sent and stamped this sweep. */
  notified: number;
  /** Sends that failed — left unstamped for the next sweep. */
  failed: number;
  /** Unnotified rows whose ZIP is still outside coverage. */
  stillUncovered: number;
}

const DEFAULT_BATCH_LIMIT = 200;

export async function notifyNewlyCoveredWaitlist(
  config: CoreConfig,
  options: NotifyNewlyCoveredOptions = {},
): Promise<NotifyNewlyCoveredResult> {
  const { db, notifier, clock } = config;
  const limit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const bookUrl = options.appOrigin
    ? `${options.appOrigin.replace(/\/$/, "")}/book`
    : undefined;

  const pending = await db
    .select()
    .from(waitlistSignups)
    .where(isNull(waitlistSignups.notifiedAt))
    .limit(limit);

  let notified = 0;
  let failed = 0;
  let stillUncovered = 0;

  for (const signup of pending) {
    if (!isInCoverage(signup.zip)) {
      stillUncovered += 1;
      continue;
    }

    try {
      await notifier.sendEmail(
        buildZoneOpenedEmail({
          to: signup.email,
          zip: signup.zip,
          ...(bookUrl === undefined ? {} : { bookUrl }),
        }),
      );
    } catch (error) {
      // Left unstamped — the next sweep retries. Per-row isolation: one bad
      // address must not block the rest of the batch.
      failed += 1;
      console.error(
        `[waitlist-notify] send failed for signup ${signup.id} (zip ${signup.zip})`,
        error,
      );
      continue;
    }

    // Stamp AFTER the successful send: a crash between send and stamp means
    // at-most-one duplicate email on the next sweep — the right side of the
    // trade against silently never sending.
    await db
      .update(waitlistSignups)
      .set({ notifiedAt: options.now ?? clock.now() })
      .where(eq(waitlistSignups.id, signup.id));
    notified += 1;
  }

  return { notified, failed, stillUncovered };
}
