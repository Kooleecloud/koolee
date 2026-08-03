/**
 * Customer-notification boundary for custody events ("driver 10 min away",
 * "bags sealed", "delivered to bag drop").
 *
 * This is a SEPARATE concern from auth OTP delivery, which Supabase Auth owns
 * end-to-end (provider credentials live only in the Supabase dashboard).
 * Custody-event SMS/email WILL eventually need real provider credentials in
 * server-side env and real adapters — that lands with the notifications work
 * item. Until then this stub reserves the boundary: custody flows call
 * `dispatcher.send(...)` today, and wiring a real adapter later changes no
 * call sites. Nothing in the auth flow imports this.
 */

export type NotificationChannel = "sms" | "email";

export interface NotificationDispatcher {
  send(input: {
    userId: string;
    template: string;
    data: Record<string, unknown>;
    preferredChannel?: NotificationChannel;
  }): Promise<void>;
}

/** Default implementation: logs and returns. */
export class NoopDispatcher implements NotificationDispatcher {
  send(input: {
    userId: string;
    template: string;
    data: Record<string, unknown>;
    preferredChannel?: NotificationChannel;
  }): Promise<void> {
    console.log(
      `[notify:dispatch] template=${input.template} user=${input.userId} channel=${
        input.preferredChannel ?? "auto"
      }`,
      input.data,
    );
    return Promise.resolve();
  }
}
