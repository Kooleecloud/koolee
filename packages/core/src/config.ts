import type { Database } from "@koolee/db";

import {
  ConsoleNotifier,
  ConsoleOpsAlerter,
  type Notifier,
  type OpsAlerter,
} from "./notifications/notifier";
import type { PaymentProvider } from "./payments/types";

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
  /** Minimum notice before a pickup window may start. */
  minimumLeadMinutes: number;
  /** ISO 4217, lowercase. */
  currency: string;
}

export const DEFAULTS: CoreDefaults = {
  bufferMinutes: 30,
  driveTimeMinutes: 60,
  minimumLeadMinutes: 90,
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
  notifier: Notifier;
  opsAlerter: OpsAlerter;
  clock: Clock;
  defaults: CoreDefaults;
}

export interface CoreConfigInput {
  db: Database;
  payments: PaymentProvider;
  notifier?: Notifier;
  opsAlerter?: OpsAlerter;
  clock?: Clock;
  defaults?: Partial<CoreDefaults>;
}

/** Fills in the safe fallbacks so callers only pass what they actually have. */
export function createCoreConfig(input: CoreConfigInput): CoreConfig {
  return {
    db: input.db,
    payments: input.payments,
    notifier: input.notifier ?? new ConsoleNotifier(),
    opsAlerter: input.opsAlerter ?? new ConsoleOpsAlerter(),
    clock: input.clock ?? systemClock,
    defaults: { ...DEFAULTS, ...input.defaults },
  };
}
