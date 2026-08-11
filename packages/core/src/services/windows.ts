import { and, eq, gt, lt } from "drizzle-orm";
import {
  airlineCutoffs,
  airports,
  pricingRules,
  slotBlocks,
  type AirportCode,
  type CutoffScope,
  type NewSlotBlock,
  type SlotBlock,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { PricingRuleInvalidError } from "../errors";
import { price, toPricingRuleInput, type PriceBreakdown } from "../pricing/engine";
import { resolveCutoffMinutes } from "../slots/cutoff";
import {
  enumerateHourlyWindows,
  type WindowUnavailableReason,
  type WindowVerdict,
} from "../slots/windows";

/**
 * Pickup-window listing for the booking flow.
 *
 * `listBookableWindows` is the only function the customer-facing picker may
 * call. It runs the same rules as `createBooking` — a window that is
 * displayed is a window that will be accepted — and quotes every window
 * through the real pricing engine, so per-window prices on the picker are
 * exactly what checkout charges.
 */

export interface BookableWindowsQuery {
  airportCode: AirportCode;
  airlineIata: string;
  scope: CutoffScope;
  departureAt: Date;
  /** Pricing inputs — the picker shows a full price per window. */
  bagCount: number;
  distanceKm: number;
  promoCode?: string | null;
  isSenior?: boolean;
  driveTimeMinutes?: number;
}

export interface PricedWindow {
  windowStart: Date;
  windowEnd: Date;
  pickupLeadMinutes: number;
  totalCents: number;
  breakdown: PriceBreakdown;
}

export interface UnavailableWindow {
  windowStart: Date;
  windowEnd: Date;
  reason: WindowUnavailableReason;
}

export interface BookableWindowsResult {
  /** Windows the customer may pick, chronological, each with its price. */
  windows: PricedWindow[];
  /**
   * The rest of the band, so an empty (or thin) picker shows the real shape
   * of the calendar instead of a void — past, short-notice, blocked, and
   * cutoff-clipped windows, each labeled with why.
   */
  unavailable: UnavailableWindow[];
  cutoffMinutes: number;
  /** Airport-local IANA zone, for rendering windows. */
  tz: string;
}

export async function listBookableWindows(
  config: CoreConfig,
  query: BookableWindowsQuery,
): Promise<BookableWindowsResult> {
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
  const tz = airport?.tz ?? "America/New_York";

  const rule = await db.query.pricingRules.findFirst({
    where: eq(pricingRules.active, true),
    orderBy: (t, { desc }) => [desc(t.effectiveFrom)],
  });
  if (!rule) {
    throw new PricingRuleInvalidError(
      "No active pricing rule. Run `pnpm seed`, or activate one in the ops console.",
    );
  }
  const ruleInput = toPricingRuleInput(rule);

  // Blackouts overlapping the band. The band spans reserve+band minutes
  // before departure; a slightly generous fetch window is fine — overlap is
  // re-checked per window.
  const blocks = await db
    .select()
    .from(slotBlocks)
    .where(
      and(
        eq(slotBlocks.airportCode, query.airportCode),
        lt(slotBlocks.blockStart, query.departureAt),
        gt(
          slotBlocks.blockEnd,
          new Date(
            query.departureAt.getTime() -
              (defaults.operationsReserveMinutes + defaults.bandMinutes) * 60_000,
          ),
        ),
      ),
    );

  const verdicts = enumerateHourlyWindows({
    departureAt: query.departureAt,
    cutoffMinutes,
    now,
    driveTimeMinutes: query.driveTimeMinutes ?? defaults.driveTimeMinutes,
    bufferMinutes: defaults.bufferMinutes,
    operationsReserveMinutes: defaults.operationsReserveMinutes,
    bandMinutes: defaults.bandMinutes,
    noticeMinutes: defaults.noticeMinutes,
    blocks,
  });

  const windows: PricedWindow[] = [];
  const unavailable: UnavailableWindow[] = [];
  for (const verdict of verdicts) {
    if (verdict.reason !== undefined) {
      unavailable.push({
        windowStart: verdict.windowStart,
        windowEnd: verdict.windowEnd,
        reason: verdict.reason,
      });
      continue;
    }
    const breakdown = price({
      rule: ruleInput,
      bagCount: query.bagCount,
      distanceKm: query.distanceKm,
      pickupLeadMinutes: verdict.pickupLeadMinutes,
      discountContext: {
        promoCode: query.promoCode ?? null,
        isSenior: query.isSenior ?? false,
      },
    });
    windows.push({
      windowStart: verdict.windowStart,
      windowEnd: verdict.windowEnd,
      pickupLeadMinutes: verdict.pickupLeadMinutes,
      totalCents: breakdown.totalCents,
      breakdown,
    });
  }

  return { windows, unavailable, cutoffMinutes, tz };
}

/* ------------------------------------------------------------------ */
/* Ops blackouts                                                       */
/* ------------------------------------------------------------------ */

export async function listSlotBlocks(
  config: CoreConfig,
  options: { airportCode?: AirportCode; from?: Date } = {},
): Promise<SlotBlock[]> {
  const conditions = [
    options.airportCode ? eq(slotBlocks.airportCode, options.airportCode) : undefined,
    options.from ? gt(slotBlocks.blockEnd, options.from) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  return config.db
    .select()
    .from(slotBlocks)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(slotBlocks.blockStart);
}

export async function createSlotBlock(
  config: CoreConfig,
  input: NewSlotBlock,
): Promise<SlotBlock> {
  const [created] = await config.db.insert(slotBlocks).values(input).returning();
  if (!created) throw new Error("Insert of slot block returned no row");
  return created;
}

export async function deleteSlotBlock(config: CoreConfig, id: string): Promise<boolean> {
  const deleted = await config.db
    .delete(slotBlocks)
    .where(eq(slotBlocks.id, id))
    .returning({ id: slotBlocks.id });
  return deleted.length > 0;
}

/** Re-export for callers that render dead-end pickers. */
export type { WindowVerdict };

export async function listAirports(db: CoreConfig["db"]) {
  return db.select().from(airports).orderBy(airports.code);
}
