import { PaymentFailedError } from "../errors";
import {
  WebhookVerificationError,
  type PaymentAuth,
  type PaymentCapture,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentRefund,
} from "./types";

/**
 * In-memory `PaymentProvider` for development and tests.
 *
 * Models the same state machine as Stripe — authorize, then capture, then
 * refund — and rejects the same illegal sequences, so a test that passes
 * against this provider is testing real orchestration logic rather than a
 * permissive stub.
 *
 * Not for production use. `verifyWebhook` accepts a fixed signature and does
 * no cryptography.
 */

type AuthState =
  /** Awaiting client confirmation — Stripe's `requires_payment_method` family. */
  | "pending_confirmation"
  /** Confirmed, outcome not yet known — Stripe's `processing`. */
  | "processing"
  | "authorized"
  | "captured"
  | "cancelled";

interface FakeAuthRecord {
  authId: string;
  bookingId: string;
  amountCents: number;
  state: AuthState;
  capturedCents: number;
}

interface FakeCaptureRecord {
  captureId: string;
  authId: string;
  amountCents: number;
  refundedCents: number;
}

export interface FakePaymentProviderOptions {
  currency?: string;
  /** Deterministic id generator. Defaults to a monotonic counter. */
  idFactory?: (prefix: string) => string;
  /** Force `authorize` to fail — for exercising rollback paths. */
  failAuthorize?: boolean;
  /**
   * Stripe parity mode: `authorize` returns `requires_action` + a client
   * secret instead of authorizing instantly, and the test drives the
   * browser's part with `simulateClientConfirmation`. Default OFF, so the
   * credential-less dev funnel keeps its one-click instant authorization.
   */
  requiresClientConfirmation?: boolean;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;

  readonly #auths = new Map<string, FakeAuthRecord>();
  readonly #captures = new Map<string, FakeCaptureRecord>();
  readonly #currency: string;
  readonly #idFactory: (prefix: string) => string;

  #counter = 0;
  failAuthorize: boolean;
  requiresClientConfirmation: boolean;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.#currency = options.currency ?? "usd";
    this.failAuthorize = options.failAuthorize ?? false;
    this.requiresClientConfirmation = options.requiresClientConfirmation ?? false;
    this.#idFactory =
      options.idFactory ??
      ((prefix) => {
        this.#counter += 1;
        return `${prefix}_${String(this.#counter).padStart(6, "0")}`;
      });
  }

  authorize(bookingId: string, amountCents: number): Promise<PaymentAuth> {
    if (this.failAuthorize) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: authorize forced to fail`),
      );
    }
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: amountCents must be a non-negative integer, got ${amountCents}`,
        ),
      );
    }

    const authId = this.#idFactory("auth");
    const state: AuthState = this.requiresClientConfirmation
      ? "pending_confirmation"
      : "authorized";
    this.#auths.set(authId, {
      authId,
      bookingId,
      amountCents,
      state,
      capturedCents: 0,
    });

    return Promise.resolve({
      authId,
      amountCents,
      currency: this.#currency,
      status: state === "authorized" ? "authorized" : "requires_action",
      clientSecret: `${authId}_secret_fake`,
    });
  }

  /** Current provider-side state, like `paymentIntents.retrieve`. */
  getAuth(authId: string): Promise<PaymentAuth> {
    const auth = this.#auths.get(authId);
    if (!auth) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: unknown authId ${authId}`),
      );
    }
    return Promise.resolve(this.#toPaymentAuth(auth));
  }

  /**
   * Amount change on a not-yet-confirmed authorization — legal in exactly
   * the states Stripe allows `paymentIntents.update({ amount })` in.
   */
  updateAuthAmount(authId: string, amountCents: number): Promise<PaymentAuth> {
    const auth = this.#auths.get(authId);
    if (!auth) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: unknown authId ${authId}`),
      );
    }
    if (auth.state !== "pending_confirmation") {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: cannot change the amount of ${authId} in state ${auth.state}`,
        ),
      );
    }
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: amountCents must be a non-negative integer, got ${amountCents}`,
        ),
      );
    }
    auth.amountCents = amountCents;
    return Promise.resolve(this.#toPaymentAuth(auth));
  }

  capture(authId: string, amountCents?: number): Promise<PaymentCapture> {
    const auth = this.#auths.get(authId);
    if (!auth) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: unknown authId ${authId}`),
      );
    }
    if (auth.state === "cancelled") {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: ${authId} was cancelled and cannot be captured`,
        ),
      );
    }
    if (auth.state === "captured") {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: ${authId} has already been captured`,
        ),
      );
    }
    if (auth.state === "pending_confirmation" || auth.state === "processing") {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: ${authId} is not authorized yet (${auth.state}) and cannot be captured`,
        ),
      );
    }

    const amount = amountCents ?? auth.amountCents;
    if (amount > auth.amountCents) {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: cannot capture ${amount} against an authorization of ${auth.amountCents}`,
        ),
      );
    }

    auth.state = "captured";
    auth.capturedCents = amount;

    const captureId = this.#idFactory("cap");
    this.#captures.set(captureId, {
      captureId,
      authId,
      amountCents: amount,
      refundedCents: 0,
    });

    return Promise.resolve({
      captureId,
      authId,
      amountCents: amount,
      status: "captured",
    });
  }

  refund(captureId: string, amountCents?: number): Promise<PaymentRefund> {
    const capture = this.#captures.get(captureId);
    if (!capture) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: unknown captureId ${captureId}`),
      );
    }

    const remaining = capture.amountCents - capture.refundedCents;
    const amount = amountCents ?? remaining;
    if (amount > remaining) {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: cannot refund ${amount}; only ${remaining} remains on ${captureId}`,
        ),
      );
    }

    capture.refundedCents += amount;

    return Promise.resolve({
      refundId: this.#idFactory("ref"),
      captureId,
      amountCents: amount,
      status: "refunded",
    });
  }

  cancelAuth(authId: string): Promise<void> {
    const auth = this.#auths.get(authId);
    if (!auth) {
      return Promise.reject(
        new PaymentFailedError(`FakePaymentProvider: unknown authId ${authId}`),
      );
    }
    if (auth.state === "captured") {
      return Promise.reject(
        new PaymentFailedError(
          `FakePaymentProvider: ${authId} is captured; refund it instead of cancelling`,
        ),
      );
    }
    auth.state = "cancelled";
    return Promise.resolve();
  }

  /**
   * Accepts the literal signature `"fake-signature"` and expects the payload to
   * be a JSON `PaymentEvent`. No cryptography — development only.
   */
  verifyWebhook(payload: string, signature: string): PaymentEvent {
    if (signature !== "fake-signature") {
      throw new WebhookVerificationError(
        `FakePaymentProvider expects the signature "fake-signature", got "${signature}"`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error: unknown) {
      throw new WebhookVerificationError("FakePaymentProvider: payload is not JSON", {
        cause: error,
      });
    }

    const event = parsed as Partial<PaymentEvent>;
    if (!event.type || !event.providerRef) {
      throw new WebhookVerificationError(
        "FakePaymentProvider: payload needs at least { type, providerRef }",
      );
    }

    return {
      id: event.id ?? this.#idFactory("evt"),
      type: event.type,
      providerRef: event.providerRef,
      ...(event.amountCents === undefined ? {} : { amountCents: event.amountCents }),
      ...(event.bookingId === undefined ? {} : { bookingId: event.bookingId }),
      raw: parsed,
    };
  }

  #toPaymentAuth(auth: FakeAuthRecord): PaymentAuth {
    const status: PaymentAuth["status"] =
      auth.state === "pending_confirmation"
        ? "requires_action"
        : auth.state === "processing"
          ? "processing"
          : auth.state === "cancelled"
            ? "failed"
            : "authorized"; // authorized and captured both hold/held the funds
    return {
      authId: auth.authId,
      amountCents: auth.amountCents,
      currency: this.#currency,
      status,
      ...(auth.state === "pending_confirmation"
        ? { clientSecret: `${auth.authId}_secret_fake` }
        : {}),
    };
  }

  /* --- test helpers ------------------------------------------------- */

  /**
   * The browser's part of the flow, driven from a test: what
   * `stripe.confirmPayment` + the card network decide.
   *
   *  - "success": funds held → authorized (the webhook/re-check may now
   *    advance the booking);
   *  - "processing": confirmation submitted, outcome pending;
   *  - "failure": declined — back to awaiting confirmation, exactly like
   *    Stripe returning the intent to `requires_payment_method` (the same
   *    intent stays reusable for a retry).
   */
  simulateClientConfirmation(
    authId: string,
    outcome: "success" | "processing" | "failure",
  ): PaymentAuth {
    const auth = this.#auths.get(authId);
    if (!auth) {
      throw new PaymentFailedError(`FakePaymentProvider: unknown authId ${authId}`);
    }
    if (auth.state !== "pending_confirmation" && auth.state !== "processing") {
      throw new PaymentFailedError(
        `FakePaymentProvider: ${authId} is ${auth.state}; there is nothing to confirm`,
      );
    }
    auth.state =
      outcome === "success"
        ? "authorized"
        : outcome === "processing"
          ? "processing"
          : "pending_confirmation";
    return this.#toPaymentAuth(auth);
  }

  /**
   * Webhook-event simulation, mirroring what Stripe + `stripe listen` give
   * you in real dev: builds the exact `{payload, signature}` pair the
   * webhook route accepts, so integration tests exercise the full
   * verify → normalise → handle path without Stripe.
   *
   *   const { payload, signature } = provider.simulateWebhook({
   *     type: "payment.captured", providerRef: auth.authId,
   *   });
   *   const event = provider.verifyWebhook(payload, signature);
   *   await handlePaymentEvent(core, event);
   */
  simulateWebhook(
    event: Pick<PaymentEvent, "type" | "providerRef"> &
      Partial<Pick<PaymentEvent, "id" | "amountCents" | "bookingId">>,
  ): { payload: string; signature: string } {
    const full: PaymentEvent = {
      id: event.id ?? this.#idFactory("evt"),
      type: event.type,
      providerRef: event.providerRef,
      ...(event.amountCents === undefined ? {} : { amountCents: event.amountCents }),
      ...(event.bookingId === undefined ? {} : { bookingId: event.bookingId }),
    };
    return { payload: JSON.stringify(full), signature: "fake-signature" };
  }

  /** Current state of an authorization, for assertions. */
  inspectAuth(authId: string): Readonly<FakeAuthRecord> | undefined {
    return this.#auths.get(authId);
  }

  /** Current state of a capture, for assertions. */
  inspectCapture(captureId: string): Readonly<FakeCaptureRecord> | undefined {
    return this.#captures.get(captureId);
  }

  /** Every authorization created, oldest first. */
  listAuths(): ReadonlyArray<Readonly<FakeAuthRecord>> {
    return [...this.#auths.values()];
  }

  reset(): void {
    this.#auths.clear();
    this.#captures.clear();
    this.#counter = 0;
    this.failAuthorize = false;
  }
}
