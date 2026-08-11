import { differenceInMinutes, subMinutes } from "date-fns";

import { computeLatestPickupStart } from "./cutoff";

/**
 * Virtual pickup windows.
 *
 * Windows are not inventory. For a flight departing at T, the bookable band
 * is the 24 hours of clock-aligned one-hour windows whose END falls in
 * (T − reserve − band, T − reserve] — at the defaults, ends in
 * (T − 30h, T − 6h]. That half-open interval yields EXACTLY 24 windows for
 * any T, on the hour or not. What limits a customer's choice is never stock:
 *
 *   - the operations reserve (default 6h): the final hours before departure
 *     belong to sealing, driving, and bag drop — applied as the STRICTER of
 *     the fixed reserve and the airline-cutoff formula, same policy as the
 *     retired slot-inventory model;
 *   - the booking notice (default 2h): a window may not start sooner than
 *     this after the moment of booking, because a driver has to be
 *     dispatched;
 *   - ops blackouts (`slot_blocks` rows), which hide windows without
 *     touching existing bookings.
 *
 * There is deliberately no capacity: every window accepts unlimited
 * bookings.
 *
 * TIMEZONE POLICY (same as cutoff.ts): all arithmetic is on absolute
 * instants. "Clock-aligned" means aligned to epoch hour boundaries, which
 * coincide with local clock hours in every whole-hour-offset zone —
 * America/New_York (all three airports) qualifies year-round, including
 * DST. Each window is 60 elapsed minutes by construction, so DST
 * transitions cannot stretch or shrink one; rendering the repeated or
 * skipped wall-clock hour is the display layer's concern.
 */

export const WINDOW_DURATION_MINUTES = 60;
const HOUR_MS = 60 * 60 * 1000;

/** A span customers cannot book into. Airport filtering happens upstream. */
export interface BlockSpan {
  blockStart: Date;
  blockEnd: Date;
}

export interface HourlyWindow {
  windowStart: Date;
  windowEnd: Date;
  /**
   * Minutes from the window's END to departure — the pricing engine's
   * lead-time input. Deterministic per (window, flight), so the price shown
   * on the picker is the price charged, whenever the customer books.
   */
  pickupLeadMinutes: number;
}

export type WindowUnavailableReason =
  /** Starts sooner than the booking notice allows (or is already past). */
  | "starts_before_notice"
  /** Overlaps an ops blackout. */
  | "blocked"
  /** The airline's cutoff is stricter than the reserve for this flight. */
  | "misses_bag_drop_cutoff"
  /** Ends before the band opens — bags would sit in custody too long. */
  | "too_early_for_flight"
  /** Not a clock-aligned one-hour span the enumerator would produce. */
  | "not_a_window";

export interface WindowVerdict extends HourlyWindow {
  /** Absent when the window is bookable. */
  reason?: WindowUnavailableReason;
}

export interface WindowRulesContext {
  /** Scheduled departure, absolute instant. */
  departureAt: Date;
  /** Airline bag-drop cutoff, minutes before departure. */
  cutoffMinutes: number;
  /** Evaluation instant. Injected so tests are deterministic. */
  now: Date;
  driveTimeMinutes: number;
  bufferMinutes: number;
  /** Fixed reserve before departure (default 6h). */
  operationsReserveMinutes: number;
  /** Length of the shopping band (default 24h). */
  bandMinutes: number;
  /** Minimum notice between booking and window start (default 2h). */
  noticeMinutes: number;
  /** Blackouts already filtered to the flight's airport. */
  blocks?: readonly BlockSpan[];
}

/** The instant the band closes: min(reserve edge, airline-cutoff formula). */
function bandDeadline(ctx: WindowRulesContext): Date {
  const latestPickupStart = computeLatestPickupStart({
    departureAt: ctx.departureAt,
    cutoffMinutes: ctx.cutoffMinutes,
    driveTimeMinutes: ctx.driveTimeMinutes,
    bufferMinutes: ctx.bufferMinutes,
  });
  const reserveEdge = subMinutes(ctx.departureAt, ctx.operationsReserveMinutes);
  return new Date(Math.min(latestPickupStart.getTime(), reserveEdge.getTime()));
}

function overlapsBlock(start: Date, end: Date, blocks: readonly BlockSpan[]): boolean {
  return blocks.some(
    (b) => start.getTime() < b.blockEnd.getTime() && end.getTime() > b.blockStart.getTime(),
  );
}

function classify(
  windowStart: Date,
  windowEnd: Date,
  ctx: WindowRulesContext,
  deadline: Date,
): WindowUnavailableReason | undefined {
  if (windowEnd.getTime() > deadline.getTime()) return "misses_bag_drop_cutoff";
  if (
    differenceInMinutes(windowStart, ctx.now) < ctx.noticeMinutes
  ) {
    return "starts_before_notice";
  }
  if (overlapsBlock(windowStart, windowEnd, ctx.blocks ?? [])) return "blocked";
  return undefined;
}

/**
 * Every window in the flight's band, chronological, each tagged with why it
 * cannot be booked — or untagged when it can. Always returns the full band
 * (24 windows at the defaults) so a picker can show real shape instead of a
 * void: past, short-notice, blocked, and cutoff-clipped windows appear with
 * their reasons.
 */
export function enumerateHourlyWindows(ctx: WindowRulesContext): WindowVerdict[] {
  assertValidContext(ctx);

  const reserveEdge = subMinutes(ctx.departureAt, ctx.operationsReserveMinutes);
  const bandFloor = subMinutes(reserveEdge, ctx.bandMinutes);
  const deadline = bandDeadline(ctx);

  // First hour boundary STRICTLY after the band floor (half-open interval).
  const firstEnd = Math.floor(bandFloor.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;

  const verdicts: WindowVerdict[] = [];
  for (let end = firstEnd; end <= reserveEdge.getTime(); end += HOUR_MS) {
    const windowEnd = new Date(end);
    const windowStart = new Date(end - HOUR_MS);
    verdicts.push({
      windowStart,
      windowEnd,
      pickupLeadMinutes: differenceInMinutes(ctx.departureAt, windowEnd),
      reason: classify(windowStart, windowEnd, ctx, deadline),
    });
  }
  return verdicts;
}

/** Just the windows a customer may pick, chronological. */
export function bookableWindows(ctx: WindowRulesContext): HourlyWindow[] {
  return enumerateHourlyWindows(ctx)
    .filter((v) => v.reason === undefined)
    .map(({ windowStart, windowEnd, pickupLeadMinutes }) => ({
      windowStart,
      windowEnd,
      pickupLeadMinutes,
    }));
}

/**
 * Validates one submitted window against the same rules the enumerator uses
 * — the booking path's acceptance check. Returns the reason it is not
 * bookable, or undefined when it is. A window the picker displayed passes;
 * anything hand-crafted (misaligned, wrong length, outside the band) does
 * not.
 */
export function evaluateHourlyWindow(
  windowStart: Date,
  windowEnd: Date,
  ctx: WindowRulesContext,
): WindowUnavailableReason | undefined {
  assertValidContext(ctx);

  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    startMs % HOUR_MS !== 0 ||
    endMs - startMs !== HOUR_MS
  ) {
    return "not_a_window";
  }

  const reserveEdge = subMinutes(ctx.departureAt, ctx.operationsReserveMinutes);
  const bandFloor = subMinutes(reserveEdge, ctx.bandMinutes);
  if (endMs <= bandFloor.getTime()) return "too_early_for_flight";
  if (endMs > reserveEdge.getTime()) return "misses_bag_drop_cutoff";

  return classify(windowStart, windowEnd, ctx, bandDeadline(ctx));
}

/** Lead-time minutes for a window of a flight — the pricing engine's input. */
export function pickupLeadMinutesFor(windowEnd: Date, departureAt: Date): number {
  return differenceInMinutes(departureAt, windowEnd);
}

function assertValidContext(ctx: WindowRulesContext): void {
  for (const [name, value] of [
    ["cutoffMinutes", ctx.cutoffMinutes],
    ["driveTimeMinutes", ctx.driveTimeMinutes],
    ["bufferMinutes", ctx.bufferMinutes],
    ["operationsReserveMinutes", ctx.operationsReserveMinutes],
    ["bandMinutes", ctx.bandMinutes],
    ["noticeMinutes", ctx.noticeMinutes],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative finite number`);
    }
  }
  if (Number.isNaN(ctx.departureAt.getTime())) {
    throw new RangeError("departureAt is not a valid date");
  }
  if (Number.isNaN(ctx.now.getTime())) {
    throw new RangeError("now is not a valid date");
  }
}
