/**
 * The payment seam.
 *
 * Koolee authorizes at booking and captures at pickup — the customer is only
 * charged once an agent has physically taken the bags. Everything below is
 * shaped around that two-step flow.
 *
 * No implementation detail of any provider appears in these types. The Stripe
 * SDK is imported in exactly one directory (`./stripe/`), enforced by an
 * ESLint `no-restricted-imports` rule everywhere else.
 */

export type PaymentProviderName = "stripe" | "fake";

export interface PaymentAuth {
  /** Provider-side authorization id (a PaymentIntent id for Stripe). */
  authId: string;
  amountCents: number;
  currency: string;
  /**
   * `requires_action`: the client must (still) confirm in the browser.
   * `processing`: confirmation happened, the outcome is not yet known —
   * distinct from `requires_action` because the client must NOT re-confirm.
   * `failed`: cancelled or expired; the authorization is dead.
   */
  status: "requires_action" | "processing" | "authorized" | "failed";
  /**
   * Returned only when the client must complete the payment in the browser.
   * For Stripe this is the PaymentIntent client secret.
   */
  clientSecret?: string;
  raw?: unknown;
}

export interface PaymentCapture {
  captureId: string;
  authId: string;
  amountCents: number;
  status: "captured" | "failed";
  raw?: unknown;
}

export interface PaymentRefund {
  refundId: string;
  captureId: string;
  amountCents: number;
  status: "refunded" | "failed";
  raw?: unknown;
}

/** Normalised webhook event — provider vocabulary does not leak past here. */
export interface PaymentEvent {
  id: string;
  type:
    | "payment.authorized"
    | "payment.captured"
    | "payment.refunded"
    | "payment.cancelled"
    | "payment.failed"
    | "payment.unknown";
  /** Provider-side reference this event concerns. */
  providerRef: string;
  amountCents?: number;
  bookingId?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;

  /** Reserve funds without taking them. */
  authorize(bookingId: string, amountCents: number): Promise<PaymentAuth>;

  /**
   * Current state of an authorization, re-read from the provider. The
   * return page's status re-check and the pay step's intent reuse both go
   * through here — a client-side success signal is never trusted alone.
   */
  getAuth(authId: string): Promise<PaymentAuth>;

  /**
   * Change the amount on a not-yet-confirmed authorization (the funnel
   * price drifted between visits to the pay step). Stripe supports this
   * natively (`paymentIntents.update`); a provider that cannot must throw
   * so the caller falls back to cancel + recreate.
   */
  updateAuthAmount(authId: string, amountCents: number): Promise<PaymentAuth>;

  /** Take the reserved funds, in full or in part, at pickup. */
  capture(authId: string, amountCents?: number): Promise<PaymentCapture>;

  /** Return captured funds, in full or in part. */
  refund(captureId: string, amountCents?: number): Promise<PaymentRefund>;

  /** Release an authorization that will never be captured. */
  cancelAuth(authId: string): Promise<void>;

  /** Verify a webhook signature and normalise the payload. Throws if invalid. */
  verifyWebhook(payload: string, signature: string): PaymentEvent;
}

export class WebhookVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebhookVerificationError";
  }
}
