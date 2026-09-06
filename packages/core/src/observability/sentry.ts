/**
 * Sentry POLICY — the decisions, in one place, with no SDK anywhere near them.
 *
 * Three apps each carry their own `@sentry/nextjs` instance, because each one
 * is its own Next build reporting to its own project. What must NOT be
 * three-of is the policy: what gets sent, at what level, with which tags, and
 * with PII off. So this module holds the options object and the mappings, core
 * stays dependency-free, and each app's Sentry file is five lines of wiring.
 *
 * Nothing here imports `@sentry/nextjs`. That is what makes it testable in the
 * core tier and what keeps `packages/core` free of a Next-only dependency.
 */

/** The tag keys. One booking's ref pulls its errors across all three projects. */
export const SENTRY_TAGS = {
  bookingRef: "booking_ref",
  userId: "user_id",
  app: "koolee_app",
} as const;

export type KooleeAppName = "web" | "admin" | "agent";

export interface SentryOptionsInput {
  /** Absent ⇒ `enabled: false`, which is what a laptop and a fresh clone run. */
  dsn: string | undefined;
  app: KooleeAppName;
  /** `VERCEL_ENV` — "production" | "preview" | "development". */
  environment: string | undefined;
  /** `VERCEL_GIT_COMMIT_SHA`, so an event names the commit that produced it. */
  release: string | undefined;
  debug?: boolean;
}

export interface SentryOptions {
  dsn: string | undefined;
  enabled: boolean;
  environment: string;
  release: string | undefined;
  /**
   * ZERO. This is an error tracker, not an APM: Koolee has no performance
   * budget question that tracing would answer, and traces are the expensive
   * half of the bill. Turning it on later is one number.
   */
  tracesSampleRate: number;
  /**
   * OFF. `sendDefaultPii` would attach IP addresses, cookies and request
   * headers to every event — on a product whose database deliberately holds no
   * passport fields and hashes OTP destinations. `booking_ref` and `user_id`
   * are the correlation keys, and both are opaque.
   */
  sendDefaultPii: false;
  initialScope: { tags: Record<string, string> };
  debug: boolean;
}

/**
 * The options every `Sentry.init` in this repo is given.
 *
 * `enabled` rather than "do not call init": the SDK's own guidance is to
 * initialise unconditionally so its instrumentation is consistent, and to let
 * the client decide whether anything leaves the process. A missing DSN would
 * disable it anyway; being explicit means a reader does not have to know that.
 */
export function sentryOptions(input: SentryOptionsInput): SentryOptions {
  return {
    dsn: input.dsn,
    enabled: Boolean(input.dsn),
    // "development" rather than undefined: an untagged event in a shared
    // project is one nobody can filter out.
    environment: input.environment ?? "development",
    release: input.release,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: { tags: { [SENTRY_TAGS.app]: input.app } },
    debug: input.debug ?? false,
  };
}

/**
 * `OpsAlerter` severity → Sentry level.
 *
 * `critical` maps to `fatal` rather than `error` so a paging rule can be
 * written against it: the 17 alert sites are already split into "somebody
 * should look at this today" and "money is not arriving / a booking is about
 * to miss a flight", and that split is worth keeping past the boundary.
 * `info` is in the map for completeness — no call site uses it.
 */
export const SENTRY_LEVEL_BY_SEVERITY = {
  critical: "fatal",
  warning: "warning",
  info: "info",
} as const;

export type OpsSeverity = keyof typeof SENTRY_LEVEL_BY_SEVERITY;
export type SentryLevel = (typeof SENTRY_LEVEL_BY_SEVERITY)[OpsSeverity];
