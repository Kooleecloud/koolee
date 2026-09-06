"use client";

import * as React from "react";

/**
 * Says something out loud the first time a value CHANGES after mount.
 *
 * The problem it solves is specific to signal-driven refreshes. A
 * `router.refresh()` re-runs the server component and the new state simply
 * appears — correct, and completely silent. A customer who looked away for
 * ten seconds comes back to a page that has quietly grown a "choose your
 * driver" card, and an agent at a door does not notice that the identity gate
 * just unlocked.
 *
 * SILENT ON MOUNT, always. The first render of a page is not news: everything
 * on it is new. Announcing there would toast on every navigation, which is the
 * fastest way to teach somebody to ignore toasts.
 *
 * The stage is a short opaque key computed on the SERVER — never a client
 * guess at what changed. That keeps the decision about what counts as a
 * milestone in the same render that has the data to decide it.
 */
export function useAnnounceChange(
  /** Null parks it entirely (a terminal booking announces nothing). */
  stage: string | null,
  announce: (next: string, previous: string) => void,
): void {
  const previous = React.useRef(stage);
  const announceRef = React.useRef(announce);
  // Declared BEFORE the effect below so it runs first: on a render where both
  // the stage and the callback changed, the announcement must use the new one.
  React.useEffect(() => {
    announceRef.current = announce;
  }, [announce]);

  React.useEffect(() => {
    if (stage === null || previous.current === null) {
      previous.current = stage;
      return;
    }
    if (previous.current === stage) return;
    const before = previous.current;
    previous.current = stage;
    announceRef.current(stage, before);
  }, [stage]);
}
