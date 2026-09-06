"use client";

import { useEffect, useState } from "react";

/**
 * Registers the agent PWA's service worker (offline shell + web push).
 *
 * WHY THIS RENDERS A HIDDEN SPAN INSTEAD OF `null`. A client component that
 * returns `null` never mounts in a Next 16 / Turbopack production build — its
 * module loads, its body runs, and its effects NEVER FIRE (PROJECT-STATUS
 * §7, learned the expensive way in F2, where `TripLive` and `LiveTasks` had
 * exactly this shape and the whole realtime layer was inert).
 *
 * This component had that shape. It returned `null`, and it ALSO returned
 * early unless `NODE_ENV === "production"` — so it did nothing in dev by
 * design and nothing in production by accident. The offline shell it exists
 * to install has therefore never installed. Found while wiring push, which
 * needs the same worker.
 *
 * `data-sw` is how "did it register?" is answered from the DOM, the same way
 * `data-live-signal` answers it for the realtime layer.
 *
 * The dev guard is gone too. It was there so hot reload was not served from
 * cache — but the worker is network-first for navigations and only ever
 * cache-first for three precached static files, so it cannot serve a stale
 * page. Keeping it would have meant push could not be tested locally at all,
 * and a channel that only exists in production is a channel nobody has seen
 * work.
 */
export function ServiceWorkerRegistrar() {
  const [state, setState] = useState<"idle" | "registered" | "unsupported" | "failed">(
    "idle",
  );

  useEffect(() => {
    let cancelled = false;

    const register = async (): Promise<void> => {
      if (!("serviceWorker" in navigator)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (!cancelled) setState("registered");
      } catch (error) {
        if (!cancelled) setState("failed");
        console.warn("[agent] service worker registration failed", error);
      }
    };

    const onLoad = () => void register();

    if (document.readyState === "complete") {
      void register();
      return () => {
        cancelled = true;
      };
    }

    window.addEventListener("load", onLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return <span hidden aria-hidden="true" data-sw={state} />;
}
