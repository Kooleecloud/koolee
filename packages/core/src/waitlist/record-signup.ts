import { waitlistSignups, type Database, type WaitlistSource } from "@koolee/db";

import { InvalidInputError } from "../errors";

/**
 * Persists a coverage-expansion waitlist signup, idempotently.
 *
 * One row per (email, zip) pair — see the table's schema comment. Re-submitting
 * a pair that already exists is a success from the visitor's point of view
 * (`created: false`), never an error: the promise "we'll email you when your
 * zone opens" is already being kept, and surfacing "already registered" would
 * leak who is on the list.
 *
 * Both capture surfaces call this with their own `source`; coverage is checked
 * by the callers BEFORE calling (a covered ZIP is sent to /book instead), so
 * rows here are uncovered-at-signup by construction.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ZIP_RE = /^\d{5}$/;

export interface RecordWaitlistSignupInput {
  email: string;
  /** 5-digit US ZIP. Required — the row is the demand signal for this zone. */
  zip: string;
  source: WaitlistSource;
}

export interface RecordWaitlistSignupResult {
  /** false when this (email, zip) pair was already on the list. */
  created: boolean;
}

export async function recordWaitlistSignup(
  db: Database,
  input: RecordWaitlistSignupInput,
): Promise<RecordWaitlistSignupResult> {
  const email = input.email.trim().toLowerCase();
  const zip = input.zip.trim();

  if (!EMAIL_RE.test(email)) throw new InvalidInputError("email");
  if (!ZIP_RE.test(zip)) throw new InvalidInputError("zip");

  const inserted = await db
    .insert(waitlistSignups)
    .values({ email, zip, source: input.source })
    .onConflictDoNothing({ target: [waitlistSignups.email, waitlistSignups.zip] })
    .returning({ id: waitlistSignups.id });

  return { created: inserted.length > 0 };
}
