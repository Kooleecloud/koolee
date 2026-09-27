import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";

import type {
  ExpoPushSendResult,
  ExpoPushSender,
  PushPayload,
  PushUrgency,
} from "./push";

/**
 * The real `ExpoPushSender`, built on `expo-server-sdk`.
 *
 * **NOT exported from the package barrel.** Reachable only as
 * `@koolee/core/expo-push`, for the same reason `WebPushSender` is only
 * `@koolee/core/web-push`: the SDK imports `undici` and `node:zlib` at module
 * scope, and anything in `src/index.ts` can end up in a client bundle. Import
 * it from an app's server-only `lib/core.ts` and nowhere else.
 *
 * WHAT EXPO'S RELAY IS. The native driver app holds an Expo push token, not
 * an APNs device token or an FCM registration — Expo's push service maps the
 * one to the other and talks to Apple and Google with credentials that live
 * in the EAS project, never here. The server POSTs plain JSON messages to
 * `exp.host` and gets back a TICKET per message (accepted or refused by
 * Expo) and, later, a RECEIPT per ticket (accepted or refused by APNs/FCM).
 * The access token is optional: sends work without it, and setting one on
 * the EAS project turns "anyone with a token can push to it" into "only
 * this server can" — CHECKLIST E1.
 *
 * Core still reads no environment: the access token arrives as an argument,
 * resolved by each app from its own validated env.
 *
 * THIS CLASS NEVER THROWS. Every call site is inside an Inngest function
 * whose email is the real notification. A dead relay must cost a log line,
 * never a failed or retried step, and never a duplicate email.
 */

/**
 * How long Expo (and, through it, APNs/FCM) holds a message for an offline
 * device. Same 300 s as web push, for the same reason: a task assignment is
 * still worth showing five minutes late, and an hour later a stale alert is
 * worse than none.
 */
const TTL_SECONDS = 300;

/**
 * The Android notification channel the app registers at start-up. Android 8+
 * drops a notification whose channel does not exist, so the app and this
 * string must agree; "default" is what `expo-notifications` creates when the
 * app asks for nothing more specific.
 */
const ANDROID_CHANNEL_ID = "default";

export interface ExpoRelayPushSenderOptions {
  /** EAS access token, when the project has enhanced push security on. */
  accessToken?: string | undefined;
}

/** A ticket or receipt that Expo answered with an error, whatever the shape. */
function errorCodeOf(entry: ExpoPushTicket | { status: string; details?: unknown }) {
  if (entry.status !== "error") return undefined;
  const details = (entry as { details?: { error?: string } }).details;
  return details?.error;
}

export class ExpoRelayPushSender implements ExpoPushSender {
  readonly delivers = true;

  readonly #expo: Expo;

  constructor(options: ExpoRelayPushSenderOptions = {}) {
    this.#expo = new Expo(
      options.accessToken === undefined ? {} : { accessToken: options.accessToken },
    );
  }

  async send(
    tokens: readonly string[],
    payload: PushPayload,
    options: { urgency?: PushUrgency } = {},
  ): Promise<ExpoPushSendResult> {
    if (tokens.length === 0) return { sent: 0, failed: 0, invalid: [], errorCodes: [] };

    try {
      return await this.#send(tokens, payload, options);
    } catch (error) {
      // The chunk loop below already contains every failure it knows about;
      // this is the belt for the braces, so that a surprise from the SDK
      // (a shape change, a thrown non-Error) still cannot reach the caller.
      console.warn(
        `[expo-push] send failed for tag ${payload.tag}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return { sent: 0, failed: tokens.length, invalid: [], errorCodes: ["RequestFailed"] };
    }
  }

  async #send(
    tokens: readonly string[],
    payload: PushPayload,
    options: { urgency?: PushUrgency },
  ): Promise<ExpoPushSendResult> {
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      // Same shape the service worker hands `notificationclick`: the deep
      // link, the collapse tag, then whatever the payload carried — and the
      // same rule that `data` is never sensitive (it sits on a lock screen).
      data: {
        ...(payload.url === undefined ? {} : { url: payload.url }),
        tag: payload.tag,
        ...payload.data,
      },
      // Expo's "high" is FCM high priority + APNs 10: wake a dozing device.
      // "default" lets the OS batch it. Same meaning as web push urgency.
      priority: options.urgency === "high" ? "high" : "default",
      channelId: ANDROID_CHANNEL_ID,
      sound: "default",
      ttl: TTL_SECONDS,
    }));

    const invalid = new Set<string>();
    const codes = new Set<string>();
    let sent = 0;
    let failed = 0;
    /**
     * One line per distinct refusal, not per device: a missing APNs key
     * refuses every iPhone in the fan-out for the same reason, and the reason
     * is what somebody reading the log needs.
     */
    const refusedWith = (code: string | undefined, message: string | undefined) => {
      const key = code ?? "Unknown";
      if (codes.has(key)) return;
      codes.add(key);
      console.warn(
        `[expo-push] relay refused tag ${payload.tag}: ${key}${message ? ` — ${message}` : ""}`,
      );
    };
    /** Tickets Expo accepted, keyed by receipt id, so a receipt can name its token. */
    const pending = new Map<string, string>();

    // Expo caps a request at 100 messages; the SDK's chunker knows the
    // number. A chunk that fails as a whole (network, 5xx, rate limit) is
    // counted failed and NOT invalid — pruning on a bad afternoon would
    // silence drivers for good.
    for (const chunk of this.#expo.chunkPushNotifications(messages)) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.#expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        failed += chunk.length;
        codes.add("RequestFailed");
        console.warn(
          `[expo-push] chunk of ${chunk.length} failed for tag ${payload.tag}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        continue;
      }

      // The nth ticket answers the nth message. A short ticket list (which
      // the SDK guards against, but which is the failure to be paranoid
      // about) reads as "not accepted" for the tail.
      chunk.forEach((message, index) => {
        const ticket = tickets[index];
        const token = typeof message.to === "string" ? message.to : (message.to[0] ?? "");
        if (!ticket || ticket.status !== "ok") {
          failed += 1;
          const code = ticket ? errorCodeOf(ticket) : "MissingTicket";
          refusedWith(code, ticket?.status === "error" ? ticket.message : undefined);
          if (code === "DeviceNotRegistered") invalid.add(token);
          return;
        }
        sent += 1;
        pending.set(ticket.id, token);
      });
    }

    // Receipts, best effort and in the same call. Expo advises polling them
    // ~15 minutes later; without a scheduler that is a job of its own, so
    // this asks ONCE, right away. Most receipts are not in yet and the map
    // comes back short — fine. The ones that are in and say
    // `DeviceNotRegistered` (an uninstalled app that APNs/FCM only reported
    // after Expo had already ticketed the send) get disabled a send earlier
    // than they otherwise would. Nothing here can make the send worse.
    if (pending.size > 0) {
      for (const ids of this.#expo.chunkPushNotificationReceiptIds([...pending.keys()])) {
        let receipts: Awaited<ReturnType<Expo["getPushNotificationReceiptsAsync"]>>;
        try {
          receipts = await this.#expo.getPushNotificationReceiptsAsync(ids);
        } catch (error) {
          console.warn(
            `[expo-push] receipts unavailable for tag ${payload.tag}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
          break;
        }
        for (const id of ids) {
          const receipt = receipts[id];
          if (!receipt || receipt.status !== "error") continue;
          // Ticketed, then refused downstream: it was counted sent above.
          sent -= 1;
          failed += 1;
          const code = errorCodeOf(receipt);
          refusedWith(code, receipt.message);
          const token = pending.get(id);
          if (token !== undefined && code === "DeviceNotRegistered") {
            invalid.add(token);
          }
        }
      }
    }

    return { sent, failed, invalid: [...invalid], errorCodes: [...codes] };
  }
}

export interface CreateExpoPushSenderInput {
  /**
   * The kill switch — the SAME `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED` that
   * gates web push. **Push is opt-in: absent means OFF.** Checked first, so
   * with the switch off a configured access token still sends nothing.
   */
  enabled: boolean;
  /** Optional. Sends work without it; see the class header. */
  accessToken?: string | undefined;
}

/**
 * A real sender when push is switched ON; otherwise null, so the runtime
 * falls back to `ConsoleExpoPushSender`.
 *
 * Unlike VAPID there is no "partially configured" state: the relay needs no
 * credentials from this side, and the access token only tightens who may
 * send. So `enabled` is the whole decision.
 */
export function createExpoPushSender(
  input: CreateExpoPushSenderInput,
): ExpoPushSender | null {
  if (!input.enabled) return null;
  return new ExpoRelayPushSender({ accessToken: input.accessToken });
}
