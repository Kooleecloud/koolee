"use client";

import { PushEnableCard } from "@koolee/ui";

import { pushNotificationsEnabled } from "@/env";

/**
 * Notifications, on the console Overview.
 *
 * A client wrapper because `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is only inlined
 * where it is written as a literal member expression.
 *
 * NO "did you see it?" STEP HERE, deliberately. The agent app gets one
 * because a driver is out on a doorstep with the app closed and a missed
 * notification is a missed pickup; an ops person is looking at this board all
 * day, and the board is already the channel. Push is the second way they find
 * out, not the only one — so the extra step buys less here than it costs.
 * `POST /api/push/test` exists in this app for when someone does want to
 * check by hand.
 */
export function NotificationsCard() {
  /*
   * The kill switch. Push ships DISABLED, so by default there is no affordance
   * here at all — offering to enable a channel the server will not send on is
   * worse than offering nothing, because it spends the browser's ONE-SHOT
   * permission prompt on a feature that cannot work.
   *
   * The service worker is deliberately NOT gated on this: it registers
   * regardless, because in this app it also carries the offline shell.
   */
  if (!pushNotificationsEnabled()) return null;

  return (
    <PushEnableCard
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
      title="Desktop notifications"
      description="Exceptions and empty driver pools, on this machine, while the console is in another tab."
    />
  );
}
