/**
 * Web Push seam.
 *
 * Mirrors `Notifier` exactly: an interface, a console default so nothing in
 * the codebase has to branch on "is push configured", and a real
 * implementation constructed by the app from its own validated env. Core
 * reads no environment and never imports `web-push`.
 *
 * ONE RULE ABOVE ALL: **push is never load-bearing.** A `201` from a push
 * service means the message was accepted for delivery, not delivered, and no
 * web API on any platform reports whether the operating system actually drew
 * the notification (the POC watched every layer report success with the
 * screen empty, because macOS had Chrome switched off in System Settings).
 * Email and the in-app realtime signal are the channels the product depends
 * on. Consequently `PushSender.send` NEVER THROWS and never retries into its
 * caller: a failed push is a logged fact, not an incident, and must not fail
 * the Inngest step whose email is the real notification.
 *
 * See docs/fixtures/chrome-notify/limitations.md for the full catalogue of
 * failures that are undetectable from inside the browser.
 */

/** Where a notification click should land, plus anything the SW echoes back. */
export interface PushPayload {
  title: string;
  body: string;
  /**
   * Collapse key. A second notification with the SAME tag REPLACES the first
   * instead of stacking — and, without `renotify`, replaces it SILENTLY.
   *
   *  - things that should stack (a new task, a new exception) ⇒ a unique tag;
   *  - a repeat of the same fact (your driver, again) ⇒ a stable tag plus
   *    `renotify: true`.
   *
   * Getting this backwards looks exactly like total delivery failure: the
   * logs say sent, the screen says nothing.
   */
  tag: string;
  /** Absolute URL for `notificationclick`. Built from the app origins. */
  url?: string;
  /** Re-alert when replacing a same-tag notification. Chromium only. */
  renotify?: boolean;
  /** Keep the notification up until dismissed. Chromium desktop only. */
  requireInteraction?: boolean;
  /**
   * Anything else the service worker should carry through to the click.
   * NEVER sensitive: the payload is decrypted on a device that may be
   * unlocked on a table. Names and a booking ref are fine; addresses and
   * anything passport-shaped are not.
   */
  data?: Record<string, unknown>;
}

/** The stored half of a subscription — exactly what `web-push` needs. */
export interface PushTarget {
  /** `push_subscriptions.id`, so a prune can name the row. */
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * How hard the push service should try.
 *
 * `high` for anything a person has to act on (a task, an exception); `normal`
 * for a milestone they will read when they read it. Urgency is a hint to the
 * push service about waking a dozing device, not a delivery guarantee.
 */
export type PushUrgency = "normal" | "high";

export interface PushSendResult {
  sent: number;
  failed: number;
  /**
   * Subscription ids the push service reported as gone (404/410). The caller
   * deletes them — a dead endpoint that is never pruned is a permanent
   * "subscribed" in the UI that will never ring again.
   */
  expired: string[];
}

export interface PushSender {
  /**
   * Whether this sender actually reaches devices.
   *
   * `false` for the console fallback, and it exists because leaving it out
   * cost a real bug. `ConsolePushSender` logs a line and returns
   * `{ sent: targets.length, failed: 0 }` — **it reports success** — so an
   * app that fell back to it had a working-looking pipeline that delivered
   * nothing. The agent app's "did you see it?" check, whose entire purpose is
   * to catch silent non-delivery, asked about notifications that had never
   * been sent.
   *
   * Counts cannot answer "was this real": a fallback and a perfect send look
   * identical in them. Anything that reports delivery to a HUMAN must consult
   * this first.
   */
  readonly delivers: boolean;

  send(
    targets: PushTarget[],
    payload: PushPayload,
    options?: { urgency?: PushUrgency },
  ): Promise<PushSendResult>;
}

/**
 * Default implementation: logs and returns. Used whenever VAPID keys are
 * absent, which includes every fresh clone.
 */
export class ConsolePushSender implements PushSender {
  /** It writes to a terminal. Nobody's phone is involved. */
  readonly delivers = false;

  readonly #prefix: string;

  constructor(prefix = "push") {
    this.#prefix = prefix;
  }

  send(targets: PushTarget[], payload: PushPayload): Promise<PushSendResult> {
    console.log(
      `[${this.#prefix}] → ${targets.length} device(s) [${payload.tag}] ` +
        `${payload.title}: ${payload.body}`,
    );
    return Promise.resolve({ sent: targets.length, failed: 0, expired: [] });
  }
}

/** Records everything sent, for assertions. */
export class RecordingPushSender implements PushSender {
  /** Stands in for a real sender in tests, so it answers as one. */
  readonly delivers = true;

  readonly sends: {
    targets: PushTarget[];
    payload: PushPayload;
    urgency: PushUrgency | undefined;
  }[] = [];

  send(
    targets: PushTarget[],
    payload: PushPayload,
    options?: { urgency?: PushUrgency },
  ): Promise<PushSendResult> {
    this.sends.push({ targets, payload, urgency: options?.urgency });
    return Promise.resolve({ sent: targets.length, failed: 0, expired: [] });
  }

  reset(): void {
    this.sends.length = 0;
  }
}
