import * as Sentry from "@sentry/nextjs";
import {
  sentryOptions,
  SENTRY_TAGS,
  type SentryOptions,
} from "@koolee/core/observability";

/**
 * This app's Sentry wiring. The POLICY — what is sent, at what level, with
 * which tags, PII off, tracing off — lives in `@koolee/core`'s
 * `observability/sentry.ts`, shared by all three apps. What is here is the
 * part that cannot be shared: each app is its own Next build reporting to its
 * own Sentry project, so each has its own SDK instance.
 *
 * The three variables are read from `process.env` rather than through
 * `@/env`, because these files run in every runtime the SDK initialises —
 * including the client bundle and the edge — and the env module's boot gates
 * are not something an instrumentation file should be able to trip.
 *
 * ⚠️ THE IMPORT PATH IS LOAD-BEARING: `@koolee/core/observability`, never the
 * `@koolee/core` barrel. `instrumentation-client.ts` pulls this file into the
 * BROWSER bundle, and the barrel reaches `postgres`, `stripe` and `unpdf` —
 * the build fails with "Can't resolve 'fs' / 'net' / 'tls' / 'perf_hooks'",
 * four errors that name Node builtins and never mention Sentry.
 */
export function options(): SentryOptions {
  return sentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    app: "web",
    // Vercel sets these. Locally both are absent, which reads as
    // "development" with no release.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });
}

/**
 * Tags the current scope with the booking an operation belongs to.
 *
 * The point of the exercise: one booking's `KOO-XXXXX` typed into Sentry's
 * search pulls every error it touched, across all three projects, whichever
 * app or runtime raised them. Call it as early as a handler knows which
 * booking it is working on.
 *
 * `bookings.ref` is display-and-support only and is never an authorization
 * key — putting it in a tag is exactly the use it was minted for.
 */
export function tagBooking(booking: {
  ref?: string | null;
  id?: string | null;
  userId?: string | null;
}): void {
  const scope = Sentry.getCurrentScope();
  if (booking.ref) scope.setTag(SENTRY_TAGS.bookingRef, booking.ref);
  if (booking.id) scope.setTag("booking_id", booking.id);
  if (booking.userId) scope.setTag(SENTRY_TAGS.userId, booking.userId);
}

/** Records an error that has already been handled. Never throws. */
export function captureHandled(error: unknown, context?: Record<string, unknown>): void {
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // An error tracker that breaks the path it is watching is worse than none.
  }
}
