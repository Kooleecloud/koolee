import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { PaymentFailedError } from "../../errors";
import { WebhookVerificationError } from "../types";
import { StripeProvider, normalizeEvent } from "./provider";

/**
 * Signature verification against the real SDK — no network involved.
 * `generateTestHeaderString` signs a payload exactly like Stripe's servers do,
 * so this catches any drift in `webhooks.constructEvent` across SDK majors.
 */

const WEBHOOK_SECRET = "whsec_test_secret";

/** Signing helper only — never makes a request. */
const signer = new Stripe("sk_test_dummy");

function signedPayload(event: Record<string, unknown>): {
  payload: string;
  signature: string;
} {
  const payload = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

function makeProvider(): StripeProvider {
  return new StripeProvider({
    secretKey: "sk_test_dummy",
    webhookSecret: WEBHOOK_SECRET,
  });
}

describe("StripeProvider.verifyWebhook", () => {
  it("accepts a correctly signed payload and normalises it", () => {
    const { payload, signature } = signedPayload({
      id: "evt_1",
      type: "payment_intent.amount_capturable_updated",
      data: {
        object: {
          id: "pi_123",
          object: "payment_intent",
          amount: 6800,
          metadata: { bookingId: "booking-1" },
        },
      },
    });

    const event = makeProvider().verifyWebhook(payload, signature);

    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("payment.authorized");
    expect(event.providerRef).toBe("pi_123");
    expect(event.bookingId).toBe("booking-1");
    expect(event.amountCents).toBe(6800);
  });

  it("rejects a payload signed with a different secret", () => {
    const payload = JSON.stringify({ id: "evt_2", type: "payment_intent.succeeded" });
    const signature = signer.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_wrong_secret",
    });

    expect(() => makeProvider().verifyWebhook(payload, signature)).toThrow(
      WebhookVerificationError,
    );
  });

  it("rejects a payload that was altered after signing", () => {
    const { payload, signature } = signedPayload({
      id: "evt_3",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123", amount: 6800 } },
    });

    const tampered = payload.replace("6800", "1");

    expect(() => makeProvider().verifyWebhook(tampered, signature)).toThrow(
      WebhookVerificationError,
    );
  });

  it("refuses to verify when no webhook secret is configured", () => {
    const provider = new StripeProvider({ secretKey: "sk_test_dummy" });

    expect(() => provider.verifyWebhook("{}", "t=1,v1=abc")).toThrow(
      WebhookVerificationError,
    );
  });
});

describe("StripeProvider.getAuth / updateAuthAmount", () => {
  function providerWithClient(client: unknown): StripeProvider {
    return new StripeProvider({
      secretKey: "sk_test_dummy",
      client: client as Stripe,
    });
  }

  it("getAuth retrieves the intent, mapping status and keeping the client secret", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "pi_1",
      amount: 6800,
      currency: "usd",
      status: "requires_payment_method",
      client_secret: "pi_1_secret_x",
    });
    const provider = providerWithClient({ paymentIntents: { retrieve } });

    const auth = await provider.getAuth("pi_1");

    expect(retrieve).toHaveBeenCalledWith("pi_1");
    expect(auth).toMatchObject({
      authId: "pi_1",
      amountCents: 6800,
      status: "requires_action",
      clientSecret: "pi_1_secret_x",
    });
  });

  it.each([
    ["requires_capture", "authorized"],
    ["processing", "processing"],
    ["canceled", "failed"],
    ["requires_action", "requires_action"],
  ] as const)("getAuth maps Stripe status %s to %s", async (stripeStatus, seamStatus) => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "pi_1",
      amount: 100,
      currency: "usd",
      status: stripeStatus,
      client_secret: "pi_1_secret_x",
    });
    const provider = providerWithClient({ paymentIntents: { retrieve } });

    expect((await provider.getAuth("pi_1")).status).toBe(seamStatus);
  });

  it("updateAuthAmount updates the intent amount through the SDK", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "pi_1",
      amount: 7300,
      currency: "usd",
      status: "requires_payment_method",
      client_secret: "pi_1_secret_x",
    });
    const provider = providerWithClient({ paymentIntents: { update } });

    const auth = await provider.updateAuthAmount("pi_1", 7300);

    expect(update).toHaveBeenCalledWith("pi_1", { amount: 7300 });
    expect(auth.amountCents).toBe(7300);
    expect(auth.clientSecret).toBe("pi_1_secret_x");
  });

  it("wraps SDK failures in PaymentFailedError", async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error("No such payment_intent"));
    const update = vi.fn().mockRejectedValue(new Error("amount cannot be updated"));
    const provider = providerWithClient({ paymentIntents: { retrieve, update } });

    await expect(provider.getAuth("pi_missing")).rejects.toThrow(PaymentFailedError);
    await expect(provider.updateAuthAmount("pi_1", 1)).rejects.toThrow(
      PaymentFailedError,
    );
  });
});

describe("normalizeEvent", () => {
  it.each([
    ["payment_intent.amount_capturable_updated", "payment.authorized"],
    ["payment_intent.succeeded", "payment.captured"],
    ["charge.refunded", "payment.refunded"],
    ["payment_intent.canceled", "payment.cancelled"],
    ["payment_intent.payment_failed", "payment.failed"],
    ["customer.created", "payment.unknown"],
  ] as const)("maps %s to %s", (stripeType, kooleeType) => {
    const event = {
      id: "evt_map",
      type: stripeType,
      data: { object: { id: "pi_1" } },
    } as unknown as Stripe.Event;

    expect(normalizeEvent(event).type).toBe(kooleeType);
  });

  it("prefers payment_intent over object id for the provider ref", () => {
    const event = {
      id: "evt_ref",
      type: "charge.captured",
      data: { object: { id: "ch_1", payment_intent: "pi_9", amount_received: 500 } },
    } as unknown as Stripe.Event;

    const normalized = normalizeEvent(event);
    expect(normalized.providerRef).toBe("pi_9");
    expect(normalized.amountCents).toBe(500);
  });
});
