import { getDb, type Database, type DbConfig } from "@koolee/db";

import {
  createCoreConfig,
  type Clock,
  type CoreConfig,
  type CoreDefaults,
} from "./config";
import { createTicketExtractor, type TicketExtractorConfig } from "./extraction/factory";
import type { Notifier, OpsAlerter } from "./notifications/notifier";
import { createPaymentProvider, type PaymentProviderConfig } from "./payments/factory";

/**
 * Runtime construction for apps.
 *
 * Apps are forbidden from importing `@koolee/db` directly (ESLint enforces it)
 * so that every query goes through a core service. That leaves core as the only
 * place that can build the database handle — hence this module.
 *
 * Apps resolve credentials through their own zod-validated `env.ts` and pass
 * plain values in. Core still reads no environment variables.
 */

export interface RuntimeOptions {
  /**
   * Pooled connection string (Supavisor transaction mode, port 6543).
   * Falls back to `DATABASE_URL` inside `@koolee/db` when omitted.
   */
  databaseUrl?: string | undefined;
  db?: DbConfig;
  payments: PaymentProviderConfig;
  /** Omitted → the free heuristic extractor. */
  extraction?: TicketExtractorConfig;
  notifier?: Notifier;
  opsAlerter?: OpsAlerter;
  clock?: Clock;
  defaults?: Partial<CoreDefaults>;
}

/**
 * Builds a `CoreConfig`.
 *
 * Throws `MissingDatabaseUrlError` when no connection string is available.
 * Nothing connects until the first query.
 */
export function createRuntime(options: RuntimeOptions): CoreConfig {
  const db: Database = getDb({
    ...options.db,
    ...(options.databaseUrl === undefined ? {} : { url: options.databaseUrl }),
  });

  return createCoreConfig({
    db,
    payments: createPaymentProvider(options.payments),
    ...(options.extraction === undefined
      ? {}
      : { ticketExtractor: createTicketExtractor(options.extraction) }),
    ...(options.notifier === undefined ? {} : { notifier: options.notifier }),
    ...(options.opsAlerter === undefined ? {} : { opsAlerter: options.opsAlerter }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.defaults === undefined ? {} : { defaults: options.defaults }),
  });
}

/**
 * Non-throwing variant for render paths that should show an empty state rather
 * than a 500 when the database is not configured — which is every page on a
 * fresh clone.
 */
export function tryCreateRuntime(options: RuntimeOptions): CoreConfig | null {
  try {
    return createRuntime(options);
  } catch {
    return null;
  }
}
