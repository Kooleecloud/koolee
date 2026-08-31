import webpush from "web-push";

import type {
  PushPayload,
  PushSendResult,
  PushSender,
  PushTarget,
  PushUrgency,
} from "./push";

/**
 * The real `PushSender`, built on the `web-push` library.
 *
 * **NOT exported from the package barrel.** It is reachable only as
 * `@koolee/core/web-push`, and that is deliberate: `web-push` is a Node-only
 * crypto library, and anything in `src/index.ts` can end up in a client
 * bundle. Import it from an app's server-only `lib/core.ts` and nowhere else.
 *
 * It lived in `apps/web` first, which was a mistake that cost a real bug: the
 * agent and admin apps then had NO real sender, fell back to
 * `ConsolePushSender` — **which logs and reports success** — and their
 * "send me a test notification" button cheerfully asked "did you see it?"
 * about a notification that had never been sent. One implementation, three
 * consumers, is the fix.
 *
 * Core still reads no environment: the three VAPID values arrive as
 * arguments, resolved by each app from its own validated env.
 *
 * `web-push` does two things it would be reckless to hand-roll: it signs the
 * VAPID JWT that authenticates Koolee to the push service (FCM, Mozilla
 * autopush, APNs), and it encrypts the payload with AES128GCM against the
 * subscription's own keys. The push service relays ciphertext it cannot read.
 *
 * THIS CLASS NEVER THROWS. Every call site is inside an Inngest function
 * whose email is the real notification. A dead push provider must cost a log
 * line, never a failed or retried step, and never a duplicate email.
 */

/**
 * How long the push service holds a message for an offline device.
 *
 * 300s. A task assignment or an exception is still worth showing five minutes
 * late; an hour later the person has either seen it in the app or the
 * situation has moved on, and a stale alert is worse than none.
 */
const TTL_SECONDS = 300;

export interface WebPushSenderOptions {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` — Apple rejects pushes without a valid subject. */
  subject: string;
}

/** Status code out of a `web-push` rejection, whatever shape it arrives in. */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export class WebPushSender implements PushSender {
  readonly delivers = true;

  readonly #options: WebPushSenderOptions;

  constructor(options: WebPushSenderOptions) {
    this.#options = options;
  }

  async send(
    targets: PushTarget[],
    payload: PushPayload,
    options: { urgency?: PushUrgency } = {},
  ): Promise<PushSendResult> {
    if (targets.length === 0) return { sent: 0, failed: 0, expired: [] };

    // Set per send rather than once at module scope: `setVapidDetails` is
    // global mutable state in the library, and a module-scope call would run
    // on import in a process that may never send anything.
    webpush.setVapidDetails(
      this.#options.subject,
      this.#options.publicKey,
      this.#options.privateKey,
    );

    const body = JSON.stringify(payload);
    const expired: string[] = [];
    let sent = 0;
    let failed = 0;

    await Promise.all(
      targets.map(async (target) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth },
            },
            body,
            { TTL: TTL_SECONDS, urgency: options.urgency ?? "normal" },
          );
          sent += 1;
        } catch (error) {
          failed += 1;
          const status = statusCodeOf(error);
          // 404/410: the subscription is gone for good. Anything else (a 5xx,
          // a timeout, a rate limit) may well work next time — pruning on
          // those would unsubscribe people for a provider's bad afternoon.
          if (status === 404 || status === 410) {
            expired.push(target.id);
          } else {
            console.warn(
              `[push] send failed (${status ?? "no status"}) for subscription ${target.id}: ` +
                (error instanceof Error ? error.message : String(error)),
            );
          }
        }
      }),
    );

    return { sent, failed, expired };
  }
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface CreateWebPushSenderInput extends Partial<VapidKeys> {
  /**
   * The kill switch. **Push is opt-in: absent means OFF.**
   *
   * Checked before the keys, and that order is the point — with the switch
   * off, a fully configured environment still sends nothing. Turning push off
   * must not depend on anybody remembering to also remove the credentials.
   */
  enabled: boolean;
}

/**
 * A real sender when push is switched ON and all three VAPID values are
 * present; otherwise null, so the runtime falls back to `ConsolePushSender`.
 *
 * All three keys or none: signing needs the pair, and Apple refuses a push
 * whose `sub` claim is not a valid mailto:/https: URL. A partially configured
 * sender would fail every send at runtime instead of at boot.
 *
 * A null return is not automatically fine — it means every send logs and
 * REPORTS SUCCESS. That is correct when push is deliberately off, and a
 * silent outage when it is not, which is why the apps' boot gates require the
 * keys whenever the switch is on, and why anything reporting to a human
 * checks `PushSender.delivers`.
 */
export function createWebPushSender(input: CreateWebPushSenderInput): PushSender | null {
  if (!input.enabled) return null;
  if (!input.publicKey || !input.privateKey || !input.subject) return null;
  return new WebPushSender({
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    subject: input.subject,
  });
}
