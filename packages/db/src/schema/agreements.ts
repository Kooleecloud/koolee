import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { bookings } from "./bookings";
import { users } from "./identity";

/**
 * The booking agreement a customer accepts before an agent may take custody
 * of their bags — versioned, and derived-current rather than flagged-current.
 *
 * WHY THERE IS NO `is_active` / `is_current` BOOLEAN
 *
 * "Current" is `max(version)` among rows whose `effective_from <= now()`.
 * That is a derivation, not a stored fact, and it stays a derivation on
 * purpose: a boolean alongside it is a SECOND source of truth for the same
 * question, and the two drift the moment anything writes one without the
 * other. That is exactly the class of bug the pricing-rule leakage was
 * (#41/#51) — a stale fixture row left `active = true` beside the real one —
 * and the fix there was to make the invariant impossible to violate rather
 * than to remember to maintain it. Here it is impossible by construction:
 * there is no column to get wrong.
 *
 * `version` is monotonic and UNIQUE, so "the newest effective version" is a
 * single unambiguous row at every instant.
 */
export const agreementVersions = pgTable(
  "agreement_versions",
  {
    id: primaryId(),
    /** Monotonic, 1-based. `publishAgreementVersion` assigns max+1. */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** Markdown. Rendered by the apps; stored verbatim. */
    bodyMd: text("body_md").notNull(),
    /**
     * When this version becomes the current one. Never in the past at
     * publish time — a retroactive `effective_from` would silently invalidate
     * acceptances of in-flight bookings, potentially mid-visit at a customer's
     * door. The rule is enforced in `publishAgreementVersion`.
     */
    effectiveFrom: timestamptz("effective_from").notNull(),
    /** The admin who published it. Null only if that account is later removed. */
    publishedBy: uuid("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agreement_versions_version_key").on(t.version),
    // The current-version derivation orders by effective_from then version.
    index("agreement_versions_effective_from_idx").on(t.effectiveFrom),
  ],
);

export type AgreementVersion = typeof agreementVersions.$inferSelect;
export type NewAgreementVersion = typeof agreementVersions.$inferInsert;

/**
 * APPEND-ONLY, for the same reason `custody_events` is: this row is the
 * evidence that a specific person agreed to specific terms at a specific
 * moment. If a claim is ever disputed, this is what we answer with — and a
 * record that can be edited after the fact answers nothing.
 *
 * Migration 0022 installs the same RAISE-on-UPDATE/DELETE trigger custody
 * events use, and this package exposes no update or delete helper for it.
 * A withdrawn agreement is not an edit: it is a new version published and a
 * new acceptance (or its absence) against that version.
 *
 * UNIQUE (booking_id) — ONE acceptance per booking, ever.
 *
 * That is the version-pinning rule as a constraint. The version a booking
 * accepts governs it for life, so a second acceptance row is not "accepting
 * an update", it is a booking bound to two different documents at once. The
 * key also makes accept idempotent: a double-submit or a retry conflicts and
 * returns the row that already exists.
 *
 * It replaced UNIQUE (booking_id, agreement_version_id), which permitted one
 * row per version and was the shape of the re-acceptance model this
 * deliberately abandoned (migration 0025).
 */
export const agreementAcceptances = pgTable(
  "agreement_acceptances",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    agreementVersionId: uuid("agreement_version_id")
      .notNull()
      .references(() => agreementVersions.id, { onDelete: "restrict" }),
    acceptedAt: timestamptz("accepted_at").notNull().defaultNow(),
    acceptedByUserId: uuid("accepted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /**
     * Whatever the accepting request actually carried — typically
     * `{ userAgent, ip }`. Nothing is fabricated here: a header the request
     * did not have is an absent key, never a placeholder. An invented IP in
     * an evidence record is worse than no IP at all.
     */
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agreement_acceptances_booking_key").on(t.bookingId),
    index("agreement_acceptances_version_idx").on(t.agreementVersionId),
  ],
);

export type AgreementAcceptance = typeof agreementAcceptances.$inferSelect;
export type NewAgreementAcceptance = typeof agreementAcceptances.$inferInsert;
