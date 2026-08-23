import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { waitlistSourceEnum } from "./enums";

/**
 * Coverage-expansion waitlist: one row per (email, zip) pair.
 *
 * The pair is the fact — "this person wants service in this zone" — so one
 * email may hold rows for several ZIPs and per-zone demand counts stay honest.
 * Covered ZIPs never land here by construction: the waitlist page redirects
 * them to /book and the funnel capture only renders for uncovered ZIPs.
 *
 * Deliberately NOT stored: whether the ZIP is covered or the email has an
 * account. Both are live questions (coverage expands, accounts get created)
 * answered at read time — a stored snapshot would be stale exactly when the
 * notify flow needs it.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: primaryId(),
    /** Lowercased by `recordWaitlistSignup` so the unique pair is case-insensitive. */
    email: text("email").notNull(),
    /** 5-digit US ZIP the signer wants covered — the demand signal, never optional. */
    zip: text("zip").notNull(),
    source: waitlistSourceEnum("source").notNull(),
    /** Stamped when the "your zone opened" email goes out. NULL = not yet notified. */
    notifiedAt: timestamptz("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("waitlist_signups_email_zip_key").on(t.email, t.zip),
    index("waitlist_signups_zip_idx").on(t.zip),
  ],
);

export type WaitlistSignupRow = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignupRow = typeof waitlistSignups.$inferInsert;
