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

type AuthState = "authorized" | "captured" | "cancelled";

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
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;

  readonly #auths = new Map<string, FakeAuthRecord>();
  readonly #captures = new Map<string, FakeCaptureRecord>();
  readonly #currency: string;
  readonly #idFactory: (prefix: string) => string;

  #counter = 0;
  failAuthorize: boolean;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.#currency = options.currency ?? "usd";
    this.failAuthorize = options.failAuthorize ?? false;
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
    this.#auths.set(authId, {
      authId,
      bookingId,
      amountCents,
      state: "authorized",
      capturedCents: 0,
    });

    return Promise.resolve({
      authId,
      amountCents,
      currency: this.#currency,
      status: "authorized",
      clientSecret: `${authId}_secret_fake`,
    });
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

  /* --- test helpers ------------------------------------------------- */

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
