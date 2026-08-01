import { doublePrecision, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId } from "./columns";
import { userRoleEnum } from "./enums";
import { bags, bookings } from "./bookings";
import { users } from "./identity";

/**
 * APPEND-ONLY. This table is the chain-of-custody source of truth: who had the
 * bag, where, when, and with what evidence. If a bag goes missing, this is the
 * record we answer to a customer — and potentially an airline — with.
 *
 * Two enforcement layers:
 *  1. Migration 0001 installs a trigger that RAISEs on UPDATE and DELETE, so
 *     even a service-role connection or a hand-typed psql statement cannot
 *     rewrite history.
 *  2. The data-access layer in this package exposes only `appendCustodyEvent`
 *     — no update or delete helper exists to call.
 *
 * Corrections are made by appending a compensating event, never by editing.
 */
export const custodyEvents = pgTable(
  "custody_events",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    /** Null for booking-level events that are not about a specific bag. */
    bagId: uuid("bag_id").references(() => bags.id, { onDelete: "restrict" }),
    /** Null for system-generated events (jobs, webhooks). */
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    actorRole: userRoleEnum("actor_role"),
    /**
     * Free-form event name, e.g. "booking.paid", "bag.sealed",
     * "bag.delivered_to_bagdrop". Kept as text rather than an enum so
     * appending a new event type never requires a migration — the writer is
     * `@koolee/core`, which types it properly.
     */
    eventType: text("event_type").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    photoUrl: text("photo_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("custody_events_booking_created_idx").on(t.bookingId, t.createdAt),
    index("custody_events_bag_id_idx").on(t.bagId),
    index("custody_events_event_type_idx").on(t.eventType),
  ],
);

export type CustodyEvent = typeof custodyEvents.$inferSelect;
export type NewCustodyEvent = typeof custodyEvents.$inferInsert;
