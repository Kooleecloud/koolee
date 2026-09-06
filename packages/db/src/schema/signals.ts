import { index, pgTable, uuid } from "drizzle-orm/pg-core";

import { timestamptz } from "./columns";
import { bookings } from "./bookings";
import { users } from "./identity";

/**
 * The realtime SIGNAL table. One row per booking, overwritten in place.
 *
 * WHAT THIS IS. A doorbell, not a message. When anything about a booking
 * changes — a status transition, an agreement accepted, a bag sealed, a
 * driver's position — this row's `updated_at` moves, Supabase Realtime
 * delivers that change to whoever is subscribed, and the client REFETCHES
 * through the ordinary server path. The payload is never rendered.
 *
 * WHY IT EXISTS AT ALL. Realtime needs RLS, and RLS on the real domain tables
 * would mean a second authorization model running beside the one in
 * `packages/core` — two places to get a rule right, one of which is invisible
 * from a test that uses the direct connection. Instead exactly ONE table is
 * readable by a client, it holds three columns, and the worst thing a policy
 * mistake here can leak is that somebody else's booking changed at some
 * instant. See docs/features/realtime-signals.md.
 *
 * NOT EVIDENCE, NOT STATE. `custody_events` is the append-only record of what
 * happened; this is mutable, has no history, and must never be read to decide
 * anything. Same rule as `driver_positions`, for the same reason.
 *
 * HOW IT IS WRITTEN. Mostly by a trigger: migration 0030 puts an AFTER INSERT
 * trigger on `custody_events`, so every custody event touches this row by
 * construction — there is no list of call sites to keep current, which is the
 * failure mode the exception-emit rewrite already paid for once. The one
 * writer that appends no custody event is the driver's GPS ping, which calls
 * `touchBookingSignal` directly.
 */
export const bookingSignals = pgTable(
  "booking_signals",
  {
    /**
     * PK, not a surrogate id: one row per booking, forever, overwritten.
     * `ON DELETE CASCADE` so a removed booking takes its doorbell with it.
     */
    bookingId: uuid("booking_id")
      .primaryKey()
      .references(() => bookings.id, { onDelete: "cascade" }),
    /** The only column a subscriber cares about — that it MOVED. */
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    /**
     * Who caused it, when we know. Diagnostics only: a client must not branch
     * on this, because it is visible to everyone the row is visible to.
     */
    touchedBy: uuid("touched_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("booking_signals_updated_at_idx").on(t.updatedAt)],
);

export type BookingSignal = typeof bookingSignals.$inferSelect;
export type NewBookingSignal = typeof bookingSignals.$inferInsert;
