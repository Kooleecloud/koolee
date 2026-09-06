"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Push, end to end, in one hook. Shared by all three apps.
 *
 * Dependency-free beyond React and coupled to no app: the VAPID public key
 * and the endpoint are passed IN. `NEXT_PUBLIC_*` is inlined by the Next
 * compiler where it is written as a literal member expression, so each app
 * reads its own and hands it here — a shared package reaching for an env var
 * is a value that silently becomes `undefined` in Storybook, in vitest, and
 * in any consumer that is not a Next build.
 *
 * THE ORDER MATTERS AND IS NOT NEGOTIABLE:
 *
 *   register /sw.js                    ← on mount, safe, asks nothing
 *     → Notification.requestPermission()   ← ONLY from a user gesture
 *     → pushManager.subscribe({ applicationServerKey })
 *     → POST the subscription so the server can reach this device
 *
 * Permission is effectively ONE-SHOT: a dismissed or denied prompt never
 * reappears on its own and the person has to dig into site settings to undo
 * it. Asking on mount spends that one chance on somebody who has no idea what
 * they are being asked for. Safari additionally REJECTS a request that is not
 * tied to a click, so `subscribe()` must only ever be called from an event
 * handler — never from an effect.
 *
 * WHAT THIS HOOK DELIBERATELY DOES NOT HAVE: a "show a local notification"
 * helper. It would be one line and it would be a trap — it proves the service
 * worker can draw a notification, which is not the question. The question is
 * whether a push sent from the server arrives, and the only way to answer it
 * is to send one and ask a human. See `confirmSeen`.
 *
 * Ported from TD's chrome-notify POC (docs/fixtures/chrome-notify/).
 */

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface PushDiagnostics {
  /** Push requires HTTPS. localhost counts as secure; a LAN IP does not. */
  secureContext: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** iOS only grants push to a site installed to the Home Screen. */
  standalone: boolean;
  browser: string;
  /** Set when the platform cannot support push at all, with the reason. */
  blocker: string | null;
}

export interface UseWebPushOptions {
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, read by the app and passed in. */
  vapidPublicKey?: string | undefined;
  /** The app's subscription endpoint. POST / PATCH / DELETE. */
  subscribeUrl?: string;
  /** Path to the app's service worker. */
  serviceWorkerUrl?: string;
}

export interface UseWebPushResult {
  /** False until the mount effect has finished looking around. */
  ready: boolean;
  /** The platform can do this AND we have a key to do it with. */
  supported: boolean;
  permission: PushPermission;
  subscribed: boolean;
  /** This device's endpoint, once subscribed — the id for verify/unsubscribe. */
  endpoint: string | null;
  /**
   * When the service worker last told us a push ARRIVED at this browser.
   *
   * The one signal that splits "it never got here" from "it got here and the
   * OS refused to draw it" — the two failures that look identical from the
   * page and have completely different fixes. Null means nothing has arrived
   * since this page loaded, which is NOT the same as "nothing was sent".
   */
  lastPushAt: number | null;
  busy: boolean;
  error: string | null;
  diagnostics: PushDiagnostics;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
  /** Records that a human confirmed they SAW a test push. */
  confirmSeen: () => Promise<void>;
}

/**
 * `applicationServerKey` wants raw bytes; the key travels as base64url text.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) {
    return /iPhone|iPad|iPod/.test(ua) ? "Safari (iOS)" : "Safari (macOS)";
  }
  return "this browser";
}

/**
 * The server render and the FIRST client render both use this.
 *
 * Every field is capability detection, which by definition cannot run on the
 * server. Seeding state with real values would make the first client render
 * disagree with the server HTML and trigger a hydration mismatch, so the real
 * values arrive one render later from the mount effect.
 */
const INITIAL_DIAGNOSTICS: PushDiagnostics = {
  secureContext: false,
  serviceWorker: false,
  pushManager: false,
  notification: false,
  standalone: false,
  browser: "checking…",
  blocker: null,
};

function readDiagnostics(): PushDiagnostics {
  if (typeof window === "undefined") return INITIAL_DIAGNOSTICS;

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Non-standard iOS Safari flag, still the only reliable signal there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const d: PushDiagnostics = {
    secureContext: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    standalone,
    browser: detectBrowser(ua),
    blocker: null,
  };

  if (!d.secureContext) {
    d.blocker =
      "Notifications need a secure connection (https). localhost is fine; an IP address is not.";
  } else if (!d.serviceWorker) {
    d.blocker = `${d.browser} can't run the background worker notifications need.`;
  } else if (!d.pushManager) {
    d.blocker = isIos
      ? "On iPhone and iPad, notifications only work once Koolee is added to your Home Screen. Tap Share, then Add to Home Screen, then open it from the icon."
      : `${d.browser} doesn't support web notifications.`;
  } else if (isIos && !standalone) {
    d.blocker =
      "On iPhone and iPad, notifications only work once Koolee is added to your Home Screen. Tap Share, then Add to Home Screen, then open it from the icon.";
  }

  return d;
}

export function useWebPush(options: UseWebPushOptions = {}): UseWebPushResult {
  const {
    vapidPublicKey,
    subscribeUrl = "/api/push/subscribe",
    serviceWorkerUrl = "/sw.js",
  } = options;

  const [ready, setReady] = useState(false);
  const [permission, setPermission] = useState<PushPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics>(INITIAL_DIAGNOSTICS);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Registers the worker and reflects any subscription that already exists.
  // Note what it does NOT do: ask for permission. That waits for a click.
  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      const d = readDiagnostics();
      if (!cancelled) setDiagnostics(d);

      if (!d.serviceWorker || !d.notification) {
        if (!cancelled) {
          setPermission("unsupported");
          setReady(true);
        }
        return;
      }

      if (!cancelled) setPermission(Notification.permission as PushPermission);

      try {
        const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
          scope: "/",
        });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        registrationRef.current = registration;

        if (d.pushManager) {
          const existing = await registration.pushManager.getSubscription();
          if (!cancelled) {
            setSubscribed(existing !== null);
            setEndpoint(existing?.endpoint ?? null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not start the background worker.",
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [serviceWorkerUrl]);

  // The worker posts a message on every push it raises. Listening is what
  // makes a failure diagnosable rather than a guess.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; at?: number } | null;
      if (data?.source !== "koolee-push" || data.type !== "push-received") return;
      setLastPushAt(data.at ?? Date.now());
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    setError(null);
    setBusy(true);

    try {
      const d = readDiagnostics();
      setDiagnostics(d);
      if (d.blocker) throw new Error(d.blocker);
      if (!vapidPublicKey) {
        throw new Error("Notifications aren't configured on this environment yet.");
      }

      const registration =
        registrationRef.current ??
        (await navigator.serviceWorker.register(serviceWorkerUrl, { scope: "/" }));
      registrationRef.current = registration;
      await navigator.serviceWorker.ready;

      // Must be close enough to the click for Safari to accept it as
      // gesture-initiated — so nothing awaited above may be slow, and nothing
      // may be inserted between the click and here.
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);
      if (result !== "granted") {
        throw new Error(
          result === "denied"
            ? `You've blocked notifications for Koolee. ${d.browser} won't ask again — turn them back on in its site settings for this page.`
            : "The permission prompt was dismissed. Tap again when you're ready.",
        );
      }

      // Reuse an existing subscription: re-subscribing with a DIFFERENT key
      // throws InvalidStateError, and the key changes whenever VAPID is
      // rotated.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required true by every browser. It is a promise that every push
          // produces a visible notification; silent data pushes get the
          // subscription revoked.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        }));

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const response = await fetch(subscribeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: json,
          label: `${d.browser}${d.standalone ? " (installed)" : ""}`,
        }),
      });
      if (!response.ok) throw new Error("We couldn't save this device. Try again.");

      setSubscribed(true);
      setEndpoint(subscription.endpoint);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn notifications on.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [serviceWorkerUrl, subscribeUrl, vapidPublicKey]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setError(null);
    setBusy(true);

    try {
      const registration =
        registrationRef.current ?? (await navigator.serviceWorker.ready);
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Server first: if the browser-side unsubscribe succeeded and the
        // server call then failed, the row would live on and every send to it
        // would 410 forever.
        await fetch(subscribeUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setSubscribed(false);
      setEndpoint(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }, [subscribeUrl]);

  const confirmSeen = useCallback(async (): Promise<void> => {
    if (!endpoint) return;
    try {
      await fetch(subscribeUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, seen: true }),
      });
    } catch {
      // A failed confirmation costs a `verified_at` timestamp and nothing the
      // person can see. Never surface it as an error over a working channel.
    }
  }, [endpoint, subscribeUrl]);

  return {
    ready,
    supported:
      diagnostics.blocker === null &&
      permission !== "unsupported" &&
      Boolean(vapidPublicKey),
    permission,
    subscribed,
    endpoint,
    lastPushAt,
    busy,
    error,
    diagnostics,
    subscribe,
    unsubscribe,
    confirmSeen,
  };
}
