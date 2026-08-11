"use client";

import { useSyncExternalStore } from "react";

/**
 * True only after hydration. `useSyncExternalStore` gives us a client/server
 * split with no effect and no setState — the operator's zone is unknowable on
 * the server, so the component renders nothing there and the real value on the
 * client, with no hydration mismatch either way.
 */
const NOOP_SUBSCRIBE = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
}

/**
 * The same instant in the OPERATOR's own zone — the console's one deliberate
 * exception to "render in the booking's zone".
 *
 * Dispatch is not tied to one place: an operator in London may be looking at a
 * JFK pickup, and asking them to do the arithmetic is how a call gets made at
 * the wrong hour. So the booking's zone stays primary and authoritative
 * everywhere, and this hangs a secondary reading off it.
 *
 * Two rules keep it from becoming the confusion it is meant to prevent:
 *
 *  1. it NEVER renders alone — it is always secondary to a booking-zone time,
 *     which is the number the customer and agent are working from;
 *  2. it renders nothing at all when the operator's zone matches the
 *     booking's, which is the common case and where a second time would be
 *     pure noise.
 *
 * Client-only by necessity: the server cannot know the operator's zone, and
 * guessing it from a header would be worse than not showing it. Rendering
 * after mount also keeps it out of the SSR output, so there is no hydration
 * mismatch between the server's zone and the browser's.
 */
export function ViewerLocalTime({
  instant,
  tz,
  className,
}: {
  /** The instant, as an ISO string — server components cannot pass Dates cheaply. */
  instant: string;
  /** The booking's display zone, so we can suppress the duplicate. */
  tz: string;
  className?: string;
}) {
  const isClient = useIsClient();
  if (!isClient) return null;

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!viewerTz || viewerTz === tz) return null;

  const when = new Date(instant);
  // Same zone under another name (America/New_York vs US/Eastern) still prints
  // an identical time — compare the rendered result, not the id, so an alias
  // does not produce a "helpful" duplicate of the line above.
  const inViewerZone = renderIn(when, viewerTz);
  if (renderIn(when, tz) === inViewerZone) return null;

  return <span className={className}>{inViewerZone} your time</span>;
}

function renderIn(instant: Date, tz: string): string {
  // The one deliberate viewer-local render in the product: this component's
  // entire job is showing the operator their OWN time, secondary to the
  // booking-zone time beside it. See the header comment.
  // eslint-disable-next-line no-restricted-syntax
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}
