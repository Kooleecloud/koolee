import Stripe from "stripe";
import { describe, expect, it } from "vitest";

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
