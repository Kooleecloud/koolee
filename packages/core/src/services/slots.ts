import { and, eq, gte } from "drizzle-orm";
import {
  airlineCutoffs,
  airports,
  pickupTasks,
  slots,
  verificationTasks,
  type AirportCode,
  type CutoffScope,
  type Database,
  type PickupTask,
  type Slot,
  type VerificationTask,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import {
  explainSlotSellability,
  filterSellableSlots,
  resolveCutoffMinutes,
  toSellableSlotInput,
  type SlotVerdict,
} from "../slots/cutoff";

/**
 * Slot listing for the booking flow.
 *
 * `listSellableSlots` is the only function the customer-facing slot picker may
 * call. It runs the same sellability rules as `createBooking`, so a slot that
 * is displayed is a slot that will be accepted.
 */

export interface SellableSlotQuery {
  airportCode: AirportCode;
  airlineIata: string;
  scope: CutoffScope;
  departureAt: Date;
  driveTimeMinutes?: number;
}

export interface SellableSlotsResult {
  slots: Slot[];
  cutoffMinutes: number;
  /** Airport-local IANA zone, for rendering windows. */
  tz: string;
}

export async function listSellableSlots(
  config: CoreConfig,
  query: SellableSlotQuery,
): Promise<SellableSlotsResult> {
  const { db, clock, defaults } = config;
  const now = clock.now();

  const cutoffRows = await db
    .select()
    .from(airlineCutoffs)
    .where(eq(airlineCutoffs.airportCode, query.airportCode));

  const cutoffMinutes = resolveCutoffMinutes(
    cutoffRows,
    {
      airlineIata: query.airlineIata,
      airportCode: query.airportCode,
      scope: query.scope,
    },
    now,
  );

  const airport = await db.query.airports.findFirst({
    where: eq(airports.code, query.airportCode),
  });

  const candidates = await db
    .select()
    .from(slots)
    .where(and(eq(slots.airportCode, query.airportCode), gte(slots.windowEnd, now)));

  const sellable = filterSellableSlots(
    candidates.map((slot) => ({ ...toSellableSlotInput(slot), row: slot })),
    {
      airportCode: query.airportCode,
      departureAt: query.departureAt,
      cutoffMinutes,
      driveTimeMinutes: query.driveTimeMinutes ?? defaults.driveTimeMinutes,
      bufferMinutes: defaults.bufferMinutes,
      minimumLeadMinutes: defaults.minimumLeadMinutes,
      now,
    },
  );

  return {
    slots: sellable.map((s) => s.row),
    cutoffMinutes,
    tz: airport?.tz ?? "America/New_York",
  };
}

/** Same query, but keeps rejected slots and their reasons — for the ops console. */
export async function explainSlots(
  config: CoreConfig,
  query: SellableSlotQuery,
): Promise<{ verdicts: SlotVerdict[]; cutoffMinutes: number }> {
  const { db, clock, defaults } = config;
  const now = clock.now();

  const cutoffRows = await db
    .select()
    .from(airlineCutoffs)
    .where(eq(airlineCutoffs.airportCode, query.airportCode));

  const cutoffMinutes = resolveCutoffMinutes(
    cutoffRows,
    {
      airlineIata: query.airlineIata,
      airportCode: query.airportCode,
      scope: query.scope,
    },
    now,
  );

  const candidates = await db
    .select()
    .from(slots)
    .where(eq(slots.airportCode, query.airportCode));

  return {
    verdicts: explainSlotSellability(candidates.map(toSellableSlotInput), {
      airportCode: query.airportCode,
      departureAt: query.departureAt,
      cutoffMinutes,
      driveTimeMinutes: query.driveTimeMinutes ?? defaults.driveTimeMinutes,
      bufferMinutes: defaults.bufferMinutes,
      minimumLeadMinutes: defaults.minimumLeadMinutes,
      now,
    }),
    cutoffMinutes,
  };
}

/* ------------------------------------------------------------------ */
/* Agent task queues                                                   */
/* ------------------------------------------------------------------ */

export interface AssignedTasks {
  verification: VerificationTask[];
  pickup: PickupTask[];
}

/**
 * Both task queues for one assignee.
 *
 * Verification and pickup are separate entities (see packages/db/README.md);
 * the agent app renders them as one list because the same person usually does
 * both, but that is a presentation choice, not a data one.
 */
export async function listAssignedTasks(
  db: Database,
  assigneeUserId: string,
): Promise<AssignedTasks> {
  const [verification, pickup] = await Promise.all([
    db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.assigneeUserId, assigneeUserId))
      .orderBy(verificationTasks.scheduledStart),
    db
      .select()
      .from(pickupTasks)
      .where(eq(pickupTasks.assigneeUserId, assigneeUserId))
      .orderBy(pickupTasks.scheduledStart),
  ]);

  return { verification, pickup };
}

export async function listAirports(db: Database) {
  return db.select().from(airports).orderBy(airports.code);
}
