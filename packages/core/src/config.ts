import type { Database } from "@koolee/db";

import { NoopEmitter, type EventEmitter } from "./events/emitter";
import {
  NoopDispatcher,
  type NotificationDispatcher,
} from "./notifications/dispatcher";
import {
  ConsoleNotifier,
  ConsoleOpsAlerter,
  type Notifier,
  type OpsAlerter,
} from "./notifications/notifier";
import type { PaymentProvider } from "./payments/types";
import { HeuristicTicketExtractor } from "./extraction/heuristic";
import type { TicketExtractor } from "./extraction/types";

/**
 * Everything the domain layer needs, injected by the app.
 *
 * `packages/core` reads no environment variables and imports nothing from
 * Next.js. Apps resolve credentials through their own zod-validated `env.ts`
 * and hand the results in here, which is what makes core testable without a
 * process environment and reusable from a job runner.
 */

export interface CoreDefaults {
  /** Operational slack between the drive and the airline cutoff. */
  bufferMinutes: number;
  /** Fallback when a real drive-time estimate is unavailable. */
  driveTimeMinutes: number;
  /**
   * Booking notice: a pickup window may not START sooner than this after
   * the moment the customer is booking — a driver has to be dispatched.
   * Only ever bites for same-day bookers grabbing the next hour or two.
   */
  noticeMinutes: number;
  /**
   * Fixed operations reserve before departure: no pickup window may end
   * inside the final N minutes before the flight — that time belongs to
   * sealing, driving, and the bag-drop handoff. Applied as the stricter of
   * this and the airline-cutoff formula.
   */
  operationsReserveMinutes: number;
  /**
   * Length of the shopping band. Windows END inside
   * (departure − reserve − band, departure − reserve] — at the defaults a
   * 24-hour band of exactly 24 one-hour windows ending where the
   * operations reserve begins.
   */
  bandMinutes: number;
  /** ISO 4217, lowercase. */
  currency: string;
}

export const DEFAULTS: CoreDefaults = {
  bufferMinutes: 30,
  driveTimeMinutes: 60,
  noticeMinutes: 2 * 60,
  operationsReserveMinutes: 6 * 60,
  bandMinutes: 24 * 60,
  currency: "usd",
};

/** Injectable clock so time-dependent logic is deterministic under test. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()) };
}

export interface CoreConfig {
  db: Database;
  payments: PaymentProvider;
  /** Ticket-PDF extraction seam. Defaults to the free heuristic extractor. */
  ticketExtractor: TicketExtractor;
  notifier: Notifier;
  /**
   * Domain event emission (queue seam). Noop unless the app's runtime passes
   * a real one — see packages/core/src/events/emitter.ts for why the adapter
   * cannot live here.
   */
  emitter: EventEmitter;
  /** Custody-event customer notifications. Noop until the notifications work item. */
  dispatcher: NotificationDispatcher;
  opsAlerter: OpsAlerter;
  clock: Clock;
  defaults: CoreDefaults;
}

export interface CoreConfigInput {
  db: Database;
  payments: PaymentProvider;
  ticketExtractor?: TicketExtractor;
  notifier?: Notifier;
  emitter?: EventEmitter;
  dispatcher?: NotificationDispatcher;
  opsAlerter?: OpsAlerter;
  clock?: Clock;
  defaults?: Partial<CoreDefaults>;
}

/** Fills in the safe fallbacks so callers only pass what they actually have. */
export function createCoreConfig(input: CoreConfigInput): CoreConfig {
  return {
    db: input.db,
    payments: input.payments,
    ticketExtractor: input.ticketExtractor ?? new HeuristicTicketExtractor(),
    notifier: input.notifier ?? new ConsoleNotifier(),
    emitter: input.emitter ?? new NoopEmitter(),
    dispatcher: input.dispatcher ?? new NoopDispatcher(),
    opsAlerter: input.opsAlerter ?? new ConsoleOpsAlerter(),
    clock: input.clock ?? systemClock,
    defaults: { ...DEFAULTS, ...input.defaults },
  };
}
