import { getDb, type Database, type DbConfig } from "@koolee/db";

import {
  createCoreConfig,
  type Clock,
  type CoreConfig,
  type CoreDefaults,
} from "./config";
import { createEventEmitter, type EventEmitterConfig } from "./events/factory";
import { createEtaEstimator, type EtaEstimatorConfig } from "./geo/factory";
import type { EtaEstimator } from "./geo/eta";
import type { EventEmitter } from "./events/emitter";
import { createTicketExtractor, type TicketExtractorConfig } from "./extraction/factory";
import { createNotifier, type NotifierConfig } from "./notifications/factory";
import type { Notifier, OpsAlerter } from "./notifications/notifier";
import type { PushSender } from "./notifications/push";
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
  /**
   * Declarative notifier selection (console vs Resend) — the normal app
   * path. Omitted → console. Ignored when an explicit `notifier` instance is
   * given (tests inject `RecordingNotifier` that way).
   */
  notifications?: NotifierConfig;
  notifier?: Notifier;
  /**
   * Web Push sender. Passed as an INSTANCE, not a declarative config, for the
   * same reason the Inngest emitter is: the real one needs the `web-push`
   * library and three VAPID values, and core must not depend on either.
   * Omitted → `ConsolePushSender`.
   */
  pushSender?: PushSender;
  /**
   * Declarative emitter selection for the credential-free choices. The real
   * queue adapter needs an event key and a client, so apps pass it as an
   * `emitter` instance instead — see events/emitter.ts. Omitted → noop.
   * Ignored when an explicit `emitter` is given.
   */
  events?: EventEmitterConfig;
  emitter?: EventEmitter;
  opsAlerter?: OpsAlerter;
  /**
   * Declarative ETA-estimator selection. Omitted → the haversine estimator,
   * which needs no credentials. A routing provider would arrive as an
   * `etaEstimator` instance for the same reason the Inngest emitter does.
   */
  eta?: EtaEstimatorConfig;
  etaEstimator?: EtaEstimator;
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
    ...(options.notifier !== undefined
      ? { notifier: options.notifier }
      : options.notifications !== undefined
        ? { notifier: createNotifier(options.notifications) }
        : {}),
    ...(options.pushSender === undefined ? {} : { pushSender: options.pushSender }),
    ...(options.emitter !== undefined
      ? { emitter: options.emitter }
      : options.events !== undefined
        ? { emitter: createEventEmitter(options.events) }
        : {}),
    ...(options.opsAlerter === undefined ? {} : { opsAlerter: options.opsAlerter }),
    ...(options.etaEstimator !== undefined
      ? { etaEstimator: options.etaEstimator }
      : options.eta !== undefined
        ? { etaEstimator: createEtaEstimator(options.eta) }
        : {}),
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
