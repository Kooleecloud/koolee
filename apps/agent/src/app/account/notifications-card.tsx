"use client";

import { PushEnableCard } from "@koolee/ui";

import { pushNotificationsEnabled } from "@/env";

/**
 * Notifications, on the agent's Account tab.
 *
 * A thin client wrapper around the shared card, and it has to be one for two
 * reasons: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is only inlined where it is written
 * as a literal member expression, and the "did you see it?" step needs a real
 * network call this app owns.
 *
 * THE TEST GOES THROUGH THE SERVER. Not `registration.showNotification`,
 * which would prove only that this worker can draw a notification — the
 * question is whether one SENT FROM KOOLEE arrives, and the two differ in
 * every way that matters: VAPID signing, the push service, the device being
 * woken, and the OS deciding whether to draw anything.
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
      title="Notifications"
      description="Get told when a visit is assigned to you, or when a pickup lands on your shift — even with the app closed."
      verify={async () => {
        const response = await fetch("/api/push/test", { method: "POST" });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          // Distinguished on purpose. "Nothing was sent" and "something was
          // sent and you did not see it" have completely different fixes, and
          // conflating them sends people to check System Settings over a
          // missing environment variable.
          if (body?.error === "not_configured") return "not_configured";
          if (body?.error === "no_subscription") return "no_subscription";
          return false;
        }
        const body = (await response.json()) as { accepted?: boolean };
        // `accepted`, never `delivered`: a 201 from a push service is not a
        // delivery receipt, which is exactly why a human is asked next.
        return body.accepted === true;
      }}
    />
  );
}
