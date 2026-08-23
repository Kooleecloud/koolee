import Stripe from "stripe";

import { PaymentFailedError } from "../../errors";
import {
  WebhookVerificationError,
  type PaymentAuth,
  type PaymentCapture,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentRefund,
} from "../types";

/**
 * Stripe implementation of `PaymentProvider`.
 *
 * THIS DIRECTORY IS THE ONLY PLACE THE STRIPE SDK MAY BE IMPORTED. An ESLint
 * `no-restricted-imports` rule fails the build anywhere else. Everything
 * outside depends on the `PaymentProvider` interface.
 *
 * Flow: `capture_method: "manual"` on the PaymentIntent authorizes funds at
 * booking without taking them; `capture()` runs when an agent has the bags.
 * An authorization that is never captured is released by `cancelAuth()`.
 *
 * The SDK client is constructed lazily on first use, so importing this module
 * with no `STRIPE_SECRET_KEY` set never throws — a hard requirement for the
 * repo to build with zero credentials.
 */

export interface StripeProviderConfig {
  secretKey: string;
  /** Required only by `verifyWebhook`. */
  webhookSecret?: string;
  /** ISO 4217, lowercase. */
  currency?: string;
  /** Injectable for tests. */
  client?: Stripe;
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  readonly #config: StripeProviderConfig;
  #client: Stripe | undefined;

  constructor(config: StripeProviderConfig) {
    this.#config = config;
    this.#client = config.client;
  }

  /** Lazy: constructing the SDK is deferred to the first real call. */
  get #stripe(): Stripe {
    if (!this.#client) {
      if (!this.#config.secretKey) {
        throw new PaymentFailedError(
          "STRIPE_SECRET_KEY is not configured. Set it, or select the FakePaymentProvider for local development.",
        );
      }
      this.#client = new Stripe(this.#config.secretKey, {
        // Pinning is deliberate: an unpinned account-default version can change
        // response shapes under us without a deploy. Must match the installed
        // SDK's pinned version (`Stripe.LatestApiVersion`) exactly.
        apiVersion: "2026-07-29.dahlia",
        typescript: true,
        appInfo: { name: "koolee", version: "0.1.0" },
      });
    }
    return this.#client;
  }

  get #currency(): string {
    return this.#config.currency ?? "usd";
  }

  async authorize(bookingId: string, amountCents: number): Promise<PaymentAuth> {
    try {
      const intent = await this.#stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: this.#currency,
          capture_method: "manual",
          automatic_payment_methods: { enabled: true },
          metadata: { bookingId },
          description: `Koolee booking ${bookingId}`,
        },
        // Retrying an authorize must not double-charge.
        { idempotencyKey: `authorize:${bookingId}:${amountCents}` },
      );

      return {
        authId: intent.id,
        amountCents: intent.amount,
        currency: intent.currency,
        status: mapIntentStatus(intent.status),
        clientSecret: intent.client_secret ?? undefined,
        raw: intent,
      };
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe authorize failed for booking ${bookingId}: ${describe(error)}`,
        error,
      );
    }
  }

  /**
   * Re-reads the intent from Stripe. `retrieve` includes the client secret,
   * which is what lets a revisit of the pay step remount the Payment Element
   * against the SAME intent instead of minting a second one.
   */
  async getAuth(authId: string): Promise<PaymentAuth> {
    try {
      const intent = await this.#stripe.paymentIntents.retrieve(authId);
      return {
        authId: intent.id,
        amountCents: intent.amount,
        currency: intent.currency,
        status: mapIntentStatus(intent.status),
        clientSecret: intent.client_secret ?? undefined,
        raw: intent,
      };
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe retrieve failed for ${authId}: ${describe(error)}`,
        error,
      );
    }
  }

  /**
   * Stripe supports changing the amount of a not-yet-confirmed intent
   * (`requires_payment_method` / `requires_confirmation` / `requires_action`)
   * — the documented "update" half of the amount-changed contract. States
   * past confirmation reject provider-side, which callers treat as the
   * cancel + recreate signal.
   */
  async updateAuthAmount(authId: string, amountCents: number): Promise<PaymentAuth> {
    try {
      const intent = await this.#stripe.paymentIntents.update(authId, {
        amount: amountCents,
      });
      return {
        authId: intent.id,
        amountCents: intent.amount,
        currency: intent.currency,
        status: mapIntentStatus(intent.status),
        clientSecret: intent.client_secret ?? undefined,
        raw: intent,
      };
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe amount update failed for ${authId}: ${describe(error)}`,
        error,
      );
    }
  }

  async capture(authId: string, amountCents?: number): Promise<PaymentCapture> {
    try {
      const intent = await this.#stripe.paymentIntents.capture(
        authId,
        amountCents === undefined ? undefined : { amount_to_capture: amountCents },
        { idempotencyKey: `capture:${authId}:${amountCents ?? "full"}` },
      );

      return {
        captureId: intent.latest_charge ? String(intent.latest_charge) : intent.id,
        authId: intent.id,
        amountCents: intent.amount_received,
        status: intent.status === "succeeded" ? "captured" : "failed",
        raw: intent,
      };
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe capture failed for ${authId}: ${describe(error)}`,
        error,
      );
    }
  }

  async refund(captureId: string, amountCents?: number): Promise<PaymentRefund> {
    try {
      const refund = await this.#stripe.refunds.create(
        {
          charge: captureId,
          ...(amountCents === undefined ? {} : { amount: amountCents }),
        },
        { idempotencyKey: `refund:${captureId}:${amountCents ?? "full"}` },
      );

      return {
        refundId: refund.id,
        captureId,
        amountCents: refund.amount,
        status: refund.status === "succeeded" ? "refunded" : "failed",
        raw: refund,
      };
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe refund failed for ${captureId}: ${describe(error)}`,
        error,
      );
    }
  }

  async cancelAuth(authId: string): Promise<void> {
    try {
      await this.#stripe.paymentIntents.cancel(authId);
    } catch (error: unknown) {
      throw new PaymentFailedError(
        `Stripe cancel failed for ${authId}: ${describe(error)}`,
        error,
      );
    }
  }

  /**
   * Verifies the Stripe signature and normalises the event.
   *
   * `payload` MUST be the raw request body string. Parsing and re-serialising
   * it changes the bytes and the signature check will fail.
   */
  verifyWebhook(payload: string, signature: string): PaymentEvent {
    const secret = this.#config.webhookSecret;
    if (!secret) {
      throw new WebhookVerificationError(
        "STRIPE_WEBHOOK_SECRET is not configured; refusing to trust an unverified webhook.",
      );
    }

    let event: Stripe.Event;
    try {
      event = this.#stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error: unknown) {
      throw new WebhookVerificationError(
        `Stripe webhook signature verification failed: ${describe(error)}`,
        { cause: error },
      );
    }

    return normalizeEvent(event);
  }
}

function mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentAuth["status"] {
  switch (status) {
    case "requires_capture":
      return "authorized";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return "requires_action";
    case "processing":
      // Confirmed, outcome pending — the client must NOT re-confirm, so this
      // is distinct from requires_action (the return page renders "pending").
      return "processing";
    case "succeeded":
      // Captured already — only possible if capture_method was changed.
      return "authorized";
    case "canceled":
      return "failed";
    default:
      return "requires_action";
  }
}

/** Maps Stripe's event vocabulary onto Koolee's. */
export function normalizeEvent(event: Stripe.Event): PaymentEvent {
  const object = event.data.object as {
    id?: string;
    amount?: number;
    amount_received?: number;
    payment_intent?: string;
    metadata?: Record<string, string>;
  };

  const providerRef = object.payment_intent ?? object.id ?? `unknown:${event.id}`;
  const bookingId = object.metadata?.bookingId;
  const amountCents = object.amount_received ?? object.amount;

  const type = ((): PaymentEvent["type"] => {
    switch (event.type) {
      case "payment_intent.amount_capturable_updated":
        return "payment.authorized";
      case "payment_intent.succeeded":
      case "charge.captured":
        return "payment.captured";
      case "charge.refunded":
      case "refund.created":
        return "payment.refunded";
      case "payment_intent.canceled":
        return "payment.cancelled";
      case "payment_intent.payment_failed":
      case "charge.failed":
        return "payment.failed";
      default:
        return "payment.unknown";
    }
  })();

  return {
    id: event.id,
    type,
    providerRef,
    ...(amountCents === undefined ? {} : { amountCents }),
    ...(bookingId === undefined ? {} : { bookingId }),
    raw: event,
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
