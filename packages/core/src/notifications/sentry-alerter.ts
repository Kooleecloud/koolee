import {
  SENTRY_LEVEL_BY_SEVERITY,
  SENTRY_TAGS,
  type SentryLevel,
} from "../observability/sentry";
import type { OpsAlerter } from "./notifier";

/**
 * `OpsAlerter` that records to Sentry as well as to the console.
 *
 * WHY BOTH. The console line is the one that survives everything: it is in
 * Vercel's runtime logs whether or not a DSN is configured, whether or not
 * Sentry is up, and whether or not the event was rate-limited. Sentry is the
 * thing that makes an alert reach a person. Dropping the log to "avoid
 * duplication" would mean the only record of a critical alert lives with a
 * third party.
 *
 * **THIS CLASS SWALLOWS ITS OWN FAILURES, AND THAT IS A HARD RULE.** Twelve of
 * the seventeen `opsAlerter.alert` call sites are in the jobs layer and are
 * NOT wrapped in a try/catch (the five service-layer ones are, each with a
 * comment saying why). An alerter that throws there fails the Inngest step and
 * triggers a retry — so a transport having a bad minute would turn "we could
 * not tell ops about a failed email" into "the email function itself is now
 * failing and retrying". The alert is the least important thing in any call
 * stack it appears in; it must never be the thing that breaks one.
 */

/** What the app hands in — `Sentry.captureEvent`, narrowed to what is used. */
export type SentryCaptureEvent = (event: {
  message: string;
  level: SentryLevel;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}) => unknown;

export interface SentryOpsAlerterOptions {
  capture: SentryCaptureEvent;
  /** Injected in tests so a swallowed-failure assertion prints nothing. */
  logger?: Pick<Console, "error" | "warn" | "log">;
}

/** `detail.bookingRef` / `detail.bookingId` become tags, so an alert is findable. */
function tagsFrom(detail: Record<string, unknown> | undefined): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!detail) return tags;
  const ref = detail["bookingRef"];
  if (typeof ref === "string" && ref.length > 0) tags[SENTRY_TAGS.bookingRef] = ref;
  const id = detail["bookingId"];
  if (typeof id === "string" && id.length > 0) tags["booking_id"] = id;
  return tags;
}

export class SentryOpsAlerter implements OpsAlerter {
  readonly #capture: SentryCaptureEvent;
  readonly #logger: Pick<Console, "error" | "warn" | "log">;

  constructor(options: SentryOpsAlerterOptions) {
    this.#capture = options.capture;
    this.#logger = options.logger ?? console;
  }

  async alert(event: {
    severity: "info" | "warning" | "critical";
    title: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    // The log first, and outside the guarded block, so the record exists even
    // if everything after it goes wrong. Same prefix `ConsoleOpsAlerter` uses,
    // so nothing that greps logs has to learn a second format.
    const line = `[ops:${event.severity}] ${event.title}`;
    if (event.severity === "critical") this.#logger.error(line, event.detail ?? {});
    else if (event.severity === "warning") this.#logger.warn(line, event.detail ?? {});
    else this.#logger.log(line, event.detail ?? {});

    try {
      this.#capture({
        message: event.title,
        level: SENTRY_LEVEL_BY_SEVERITY[event.severity],
        tags: tagsFrom(event.detail),
        ...(event.detail === undefined ? {} : { extra: event.detail }),
      });
    } catch (error) {
      // Never rethrown. See the class header: twelve call sites are unwrapped
      // Inngest steps.
      this.#logger.error("[ops] Sentry capture failed", error);
    }
  }
}
