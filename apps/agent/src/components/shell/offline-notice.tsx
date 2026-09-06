"use client";

import * as React from "react";
import { CloudOff } from "lucide-react";

/**
 * "You're offline — this is what we last loaded."
 *
 * THE HONEST MINIMUM, and deliberately not more. This app's service worker is
 * an offline SHELL only: it serves a fallback page for a failed navigation and
 * caches no API responses and queues no mutations. A page already rendered
 * stays rendered when the signal drops — the data is in the browser — and
 * `router.refresh()` simply fails, silently.
 *
 * Silently is the problem. A driver reading a stop list with no idea it is ten
 * minutes stale will act on it. This says so. It does not pretend to have
 * offline data it does not have, and it does not queue anything: a durable
 * outbox for custody capture is real work with real correctness questions
 * (see sw.js), and a half-built one is worse than none.
 */
export function OfflineNotice() {
  // Starts optimistic and is corrected on mount: `navigator` does not exist
  // during SSR, and rendering "offline" for one frame on every page load
  // would be its own kind of lie.
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">You&rsquo;re offline.</span> This is what we last
        loaded — it may have changed. Anything you tap will wait for a signal.
      </p>
    </div>
  );
}
