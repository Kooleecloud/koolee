import { index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { users } from "./identity";

/**
 * Web Push subscriptions — one row per (person, browser install).
 *
 * WHAT A ROW IS. The browser's half of a push channel: an `endpoint` URL at
 * the vendor's push service (FCM for Chrome, Mozilla autopush, APNs for
 * Safari) plus the two keys the payload is encrypted to. Koolee never talks
 * to a device; it POSTs an encrypted blob to that endpoint and the push
 * service delivers it. The plaintext is never visible to the push service.
 *
 * KEYED BY USER **AND** ENDPOINT. One person on a laptop, a phone and a
 * kiosk is three rows, and all three should ring. The unique index is on
 * `endpoint` alone rather than the pair, because an endpoint identifies one
 * browser install globally: if a device is handed to somebody else and they
 * sign in, the same endpoint must MOVE to the new user rather than
 * duplicating, or the previous person keeps receiving their notifications.
 * That is why subscribe is an upsert on `endpoint` that overwrites
 * `user_id`.
 *
 * PUSH IS NEVER LOAD-BEARING. A row here is a best effort, not a guarantee:
 * a `201` from a push service means accepted, not delivered, and no web API
 * on any platform reports whether the OS actually drew the notification.
 * Email and the in-app realtime signal remain the channels the product
 * depends on. See docs/features/notifications.md.
 *
 * ROWS DIE ON THEIR OWN. Subscriptions expire, rotate when the browser feels
 * like it, and vanish when someone clears site data. The sender prunes on a
 * 404/410 from the push service, and the service worker's
 * `pushsubscriptionchange` handler re-registers a rotated one — without that
 * handler, rotation kills push permanently while the UI still says
 * "subscribed".
 *
 * NO CONTENT LIVES HERE. This table holds routing, never a message.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: primaryId(),
    /**
     * Whose device this is. The server derives it from the session — never
     * from a request body — so a caller cannot subscribe on behalf of
     * somebody else.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The push service URL. Long (FCM's run to several hundred characters)
     * and opaque; `text` rather than a guessed varchar length.
     */
    endpoint: text("endpoint").notNull(),
    /** Client public key (P-256, base64url) — the payload is encrypted to it. */
    p256dh: text("p256dh").notNull(),
    /** Client auth secret (base64url). Half of the AES128GCM key agreement. */
    auth: text("auth").notNull(),
    /**
     * Human label for the device, e.g. "Chrome (installed)". Shown to the
     * person managing their own devices; never parsed, never branched on.
     */
    label: varchar("label", { length: 120 }),
    /**
     * Which app the subscription was made from. A driver's phone and an
     * ops laptop are different audiences, and the scope decides what a
     * `notificationclick` deep link can even open.
     */
    app: varchar("app", { length: 16 }).notNull(),
    createdAt: createdAt(),
    /** Touched on every successful send and re-registration. */
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    /**
     * When a HUMAN confirmed they actually saw a test notification.
     *
     * The only trustworthy signal that this channel works: permission can be
     * granted, the push delivered, the service worker fired and the promise
     * resolved with the screen staying empty (macOS per-app switch, Focus, an
     * alert style of "None"). Null means unverified, not broken.
     */
    verifiedAt: timestamptz("verified_at"),
  },
  (t) => [
    // One row per browser install, globally. See the header: an endpoint that
    // reappears under a new user MOVES rather than duplicating.
    uniqueIndex("push_subscriptions_endpoint_key").on(t.endpoint),
    // The send path's only query: "every subscription for these people".
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

/** Which app a subscription was created from. */
export const PUSH_APPS = ["web", "agent", "admin"] as const;
export type PushApp = (typeof PUSH_APPS)[number];
