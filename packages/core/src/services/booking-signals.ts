import { desc, eq, inArray, sql } from "drizzle-orm";
import { bookingSignals, type BookingSignal, type Database } from "@koolee/db";

/**
 * The realtime doorbell, from core's side.
 *
 * WHAT A SIGNAL IS. `booking_signals` holds one mutable row per booking whose
 * `updated_at` moves whenever anything about that booking changes. A browser
 * subscribes to it over the anon key, learns THAT something happened, and then
 * refetches through the ordinary server path. The payload is never rendered
 * and never trusted — which is what keeps Drizzle the sole read path and makes
 * an RLS mistake here cost a spurious refetch rather than a disclosure.
 *
 * WHY THIS FILE IS SHORT. Almost every touch is a database trigger: migration
 * 0030 fires `public.touch_booking_signal()` AFTER INSERT on `custody_events`,
 * so all ~20 services that append custody evidence signal by construction,
 * including ones written after this. There is no list of call sites to keep
 * current — the failure mode that took six of seven exception paths silent for
 * a whole slice (see events/booking-events.ts).
 *
 * `touchBookingSignal` exists for the ONE writer that appends no custody
 * event: the driver's GPS ping. A position is not evidence, deliberately, so
 * it cannot ride the trigger — and a customer watching a driver approach is
 * exactly the case that wants a live update.
 *
 * WHAT NEVER SIGNALS. Time passing. "Running late" and "missed cutoff" are
 * computed from the clock in `services/actionability.ts`; nothing is written
 * when they become true, so nothing can be signalled. The client's polling
 * fallback is what surfaces them, and it is the honest mechanism for a state
 * change nobody performs.
 */

/** Never throws — see `touchBookingSignal`. */
async function touchQuietly(db: Database, bookingId: string, touchedBy: string | null) {
  try {
    await db
      .insert(bookingSignals)
      .values({ bookingId, updatedAt: new Date(), touchedBy })
      .onConflictDoUpdate({
        target: bookingSignals.bookingId,
        set: { updatedAt: new Date(), touchedBy },
      });
  } catch (error) {
    // Same contract as event emission: the work that caused the signal has
    // already committed, and failing the caller now would report a change
    // that demonstrably happened as an error. The client degrades to polling.
    console.error(`[signals] failed to touch booking ${bookingId}`, error);
  }
}

export interface TouchBookingSignalInput {
  bookingId: string;
  /** Diagnostics only. Visible to everyone the row is visible to. */
  touchedByUserId?: string | null;
}

/**
 * Rings the doorbell for one booking.
 *
 * Call this ONLY from a path that changes something a watcher should see and
 * appends no custody event. Anything that appends one is already covered by
 * the trigger, and calling both would be a second, drift-prone mechanism for
 * the same fact.
 *
 * NEVER THROWS. A signal is an optimisation over polling; losing one delays a
 * refresh by the poll interval and loses nothing else.
 */
export async function touchBookingSignal(
  db: Database,
  input: TouchBookingSignalInput,
): Promise<void> {
  await touchQuietly(db, input.bookingId, input.touchedByUserId ?? null);
}

/**
 * Rings it for several bookings at once.
 *
 * One statement, because the caller with more than one is the GPS ping: a
 * driver holding three bookings' bags pings every 20–45 seconds, and three
 * round-trips per ping is the shape that turns a cheap path into an expensive
 * one.
 */
export async function touchBookingSignals(
  db: Database,
  bookingIds: readonly string[],
  touchedByUserId?: string | null,
): Promise<void> {
  const unique = [...new Set(bookingIds.filter(Boolean))];
  if (unique.length === 0) return;

  const touchedBy = touchedByUserId ?? null;
  try {
    await db
      .insert(bookingSignals)
      .values(
        unique.map((bookingId) => ({ bookingId, updatedAt: new Date(), touchedBy })),
      )
      .onConflictDoUpdate({
        target: bookingSignals.bookingId,
        set: { updatedAt: sql`excluded.updated_at`, touchedBy: sql`excluded.touched_by` },
      });
  } catch (error) {
    console.error(`[signals] failed to touch ${unique.length} bookings`, error);
  }
}

/** One booking's signal row, or null when it has never been touched. */
export async function getBookingSignal(
  db: Database,
  bookingId: string,
): Promise<BookingSignal | null> {
  const row = await db.query.bookingSignals.findFirst({
    where: eq(bookingSignals.bookingId, bookingId),
  });
  return row ?? null;
}

/**
 * The newest signal instant across a set of bookings, or null.
 *
 * The polling fallback's cheap question: "has anything I am watching moved?".
 * One row back, whatever the size of the set.
 */
export async function latestSignalFor(
  db: Database,
  bookingIds: readonly string[],
): Promise<Date | null> {
  const unique = [...new Set(bookingIds.filter(Boolean))];
  if (unique.length === 0) return null;

  const [row] = await db
    .select({ updatedAt: bookingSignals.updatedAt })
    .from(bookingSignals)
    .where(inArray(bookingSignals.bookingId, unique))
    .orderBy(desc(bookingSignals.updatedAt))
    .limit(1);

  return row?.updatedAt ?? null;
}
