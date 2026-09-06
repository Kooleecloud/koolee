/**
 * Absolute links into the apps, built from an origin the APP injects.
 *
 * `packages/core` reads no environment, so every origin here arrives as a
 * value (`NEXT_PUBLIC_APP_URL` in each app's `env.ts`). An absent origin
 * yields `undefined` rather than a relative path: a relative link is fine in
 * a browser and useless in an email or a notification, which is exactly where
 * these are consumed. Callers omit the field instead of shipping `/trips/…`
 * to somebody's inbox.
 */

function join(origin: string | undefined, path: string): string | undefined {
  return origin ? `${origin.replace(/\/$/, "")}${path}` : undefined;
}

/** Customer trip page (apps/web). UUID-addressed — never `bookings.ref`. */
export function tripUrlFor(
  appOrigin: string | undefined,
  bookingId: string,
): string | undefined {
  return join(appOrigin, `/trips/${bookingId}`);
}

/**
 * A staff task in the agent app.
 *
 * ONE route takes both kinds: `/tasks/[taskId]` resolves a pickup task first
 * and falls back to a verification visit, so the caller passes whichever id
 * the moment is about and does not encode the kind in the URL.
 */
export function taskUrlFor(
  agentOrigin: string | undefined,
  taskId: string,
): string | undefined {
  return join(agentOrigin, `/tasks/${taskId}`);
}

/** A booking in the ops console — where an exception is actually resolved. */
export function adminBookingUrlFor(
  adminOrigin: string | undefined,
  bookingId: string,
): string | undefined {
  return join(adminOrigin, `/bookings/${bookingId}`);
}
