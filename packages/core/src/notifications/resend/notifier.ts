import {
  ConsoleNotifier,
  type EmailMessage,
  type Notifier,
  type SmsMessage,
} from "../notifier";

/**
 * Resend implementation of the email side of `Notifier`.
 *
 * Same boundary idea as `payments/stripe`: this directory is the only place
 * that talks to Resend. It uses the REST API directly (one POST) through an
 * injectable `fetch`, so there is no SDK dependency and no live call in
 * tests; if the `resend` SDK is ever adopted, it may be imported HERE only.
 *
 * SMS is deliberately NOT built — `sendSms` stays the console fallback, and
 * the `NotificationDispatcher` seam means wiring Twilio later changes no
 * call sites.
 *
 * Failure contract: a non-2xx response or network error THROWS
 * `ResendSendError`. Swallowing is the caller's decision — booking-flow call
 * sites and the Inngest functions log + ops-alert instead of failing the
 * flow, but a caller that WANTS to retry (Inngest steps) needs the throw.
 */

export class ResendSendError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ResendSendError";
    if (status !== undefined) this.status = status;
  }
}

export interface ResendNotifierOptions {
  apiKey: string;
  /** RFC 5322 From, e.g. `Koolee <notify@koolee.com>`. From RESEND_FROM. */
  from: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendNotifier implements Notifier {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #smsFallback = new ConsoleNotifier("notify:resend");

  constructor(options: ResendNotifierOptions) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    const response = await this.#fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.#from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
        ...(message.html === undefined ? {} : { html: message.html }),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ResendSendError(
        `Resend refused the send (${response.status}): ${detail.slice(0, 300)}`,
        response.status,
      );
    }
  }

  /** SMS side of the seam is unchanged: console until the Twilio work item. */
  sendSms(message: SmsMessage): Promise<void> {
    return this.#smsFallback.sendSms(message);
  }
}
