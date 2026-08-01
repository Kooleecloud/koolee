import { asc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { custodyEvents, type CustodyEvent, type NewCustodyEvent } from "./schema";

/**
 * The complete data-access surface for `custody_events`.
 *
 * Append and read. There is intentionally no `updateCustodyEvent` or
 * `deleteCustodyEvent` — the table is the chain-of-custody record, and a
 * trigger installed by migration 0001 will raise if anything tries. Corrections
 * are appended as compensating events.
 */

export type CustodyEventInsert = Omit<NewCustodyEvent, "id" | "createdAt">;

/**
 * Appends one event.
 *
 * Pass the transaction handle when writing alongside other rows so the event
 * and the state change it describes commit together.
 */
export async function appendCustodyEvent(
  db: Pick<Database, "insert">,
  event: CustodyEventInsert,
): Promise<CustodyEvent> {
  const [row] = await db.insert(custodyEvents).values(event).returning();
  if (!row) throw new Error("Failed to append custody event");
  return row;
}

/** Appends several events in one statement. */
export async function appendCustodyEvents(
  db: Pick<Database, "insert">,
  events: CustodyEventInsert[],
): Promise<CustodyEvent[]> {
  if (events.length === 0) return [];
  return db.insert(custodyEvents).values(events).returning();
}

/** Full timeline for a booking, oldest first. */
export async function listCustodyEvents(
  db: Database,
  bookingId: string,
): Promise<CustodyEvent[]> {
  return db
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.bookingId, bookingId))
    .orderBy(asc(custodyEvents.createdAt));
}
