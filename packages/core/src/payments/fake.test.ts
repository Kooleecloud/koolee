import { beforeEach, describe, expect, it } from "vitest";

import { PaymentFailedError } from "../errors";
import { FakePaymentProvider } from "./fake";
import { createPaymentProvider } from "./factory";
import { WebhookVerificationError } from "./types";

describe("FakePaymentProvider", () => {
  let provider: FakePaymentProvider;

  beforeEach(() => {
    provider = new FakePaymentProvider();
  });

  it("authorizes without capturing", async () => {
    const auth = await provider.authorize("booking-1", 6800);

    expect(auth.authId).toMatch(/^auth_/);
    expect(auth.amountCents).toBe(6800);
    expect(auth.status).toBe("authorized");
    expect(auth.clientSecret).toBeDefined();
    expect(provider.inspectAuth(auth.authId)?.state).toBe("authorized");
    expect(provider.inspectAuth(auth.authId)?.capturedCents).toBe(0);
  });

  it("captures the full amount by default", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    const capture = await provider.capture(auth.authId);

    expect(capture.amountCents).toBe(6800);
    expect(capture.status).toBe("captured");
    expect(provider.inspectAuth(auth.authId)?.state).toBe("captured");
  });

  it("captures a partial amount", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    const capture = await provider.capture(auth.authId, 5000);

    expect(capture.amountCents).toBe(5000);
    expect(provider.inspectAuth(auth.authId)?.capturedCents).toBe(5000);
  });

  it("refuses to capture more than was authorized", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await expect(provider.capture(auth.authId, 9999)).rejects.toThrow(PaymentFailedError);
  });

  it("refuses to capture twice", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await provider.capture(auth.authId);
    await expect(provider.capture(auth.authId)).rejects.toThrow(/already been captured/);
  });

  it("refuses to capture a cancelled authorization", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await provider.cancelAuth(auth.authId);
    await expect(provider.capture(auth.authId)).rejects.toThrow(/cancelled/);
  });

  it("refuses to cancel a captured authorization", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await provider.capture(auth.authId);
    await expect(provider.cancelAuth(auth.authId)).rejects.toThrow(/refund it instead/);
  });

  it("refunds up to the captured amount, in parts", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    const capture = await provider.capture(auth.authId);

    const first = await provider.refund(capture.captureId, 2000);
    expect(first.amountCents).toBe(2000);

    const second = await provider.refund(capture.captureId);
    expect(second.amountCents).toBe(4800);

    await expect(provider.refund(capture.captureId, 1)).rejects.toThrow(/only 0 remains/);
  });

  it("rejects unknown ids", async () => {
    await expect(provider.capture("nope")).rejects.toThrow(/unknown authId/);
    await expect(provider.refund("nope")).rejects.toThrow(/unknown captureId/);
    await expect(provider.cancelAuth("nope")).rejects.toThrow(/unknown authId/);
  });

  it("rejects a non-integer or negative amount", async () => {
    await expect(provider.authorize("b", -1)).rejects.toThrow(PaymentFailedError);
    await expect(provider.authorize("b", 12.5)).rejects.toThrow(PaymentFailedError);
  });

  it("can be forced to fail, for rollback tests", async () => {
    provider.failAuthorize = true;
    await expect(provider.authorize("booking-1", 6800)).rejects.toThrow(
      PaymentFailedError,
    );
    expect(provider.listAuths()).toHaveLength(0);
  });

  it("generates deterministic ids when given an id factory", async () => {
    const deterministic = new FakePaymentProvider({
      idFactory: (prefix) => `${prefix}_fixed`,
    });
    const auth = await deterministic.authorize("booking-1", 100);
    expect(auth.authId).toBe("auth_fixed");
  });

  it("resets cleanly", async () => {
    await provider.authorize("booking-1", 100);
    provider.reset();
    expect(provider.listAuths()).toHaveLength(0);
  });
});

describe("FakePaymentProvider client-confirmation parity (Stripe-like mode)", () => {
  let provider: FakePaymentProvider;

  beforeEach(() => {
    provider = new FakePaymentProvider({ requiresClientConfirmation: true });
  });

  it("authorize returns requires_action + a client secret instead of holding funds", async () => {
    const auth = await provider.authorize("booking-1", 6800);

    expect(auth.status).toBe("requires_action");
    expect(auth.clientSecret).toBe(`${auth.authId}_secret_fake`);
    expect(provider.inspectAuth(auth.authId)?.state).toBe("pending_confirmation");
  });

  it("getAuth reports the current state, keeping the client secret while confirmable", async () => {
    const auth = await provider.authorize("booking-1", 6800);

    const before = await provider.getAuth(auth.authId);
    expect(before.status).toBe("requires_action");
    expect(before.clientSecret).toBeDefined();
    expect(before.amountCents).toBe(6800);

    provider.simulateClientConfirmation(auth.authId, "success");
    const after = await provider.getAuth(auth.authId);
    expect(after.status).toBe("authorized");
    expect(after.clientSecret).toBeUndefined();
  });

  it("simulateClientConfirmation drives success / processing / failure like the browser would", async () => {
    const a = await provider.authorize("b1", 100);
    expect(provider.simulateClientConfirmation(a.authId, "success").status).toBe(
      "authorized",
    );

    const b = await provider.authorize("b2", 100);
    expect(provider.simulateClientConfirmation(b.authId, "processing").status).toBe(
      "processing",
    );
    // A processing confirmation can still settle.
    expect(provider.simulateClientConfirmation(b.authId, "success").status).toBe(
      "authorized",
    );

    // A decline bounces back to confirmable — the SAME intent stays reusable.
    const c = await provider.authorize("b3", 100);
    expect(provider.simulateClientConfirmation(c.authId, "failure").status).toBe(
      "requires_action",
    );
    expect(provider.simulateClientConfirmation(c.authId, "success").status).toBe(
      "authorized",
    );
  });

  it("refuses to capture before the client confirmed", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await expect(provider.capture(auth.authId)).rejects.toThrow(/not authorized yet/);

    provider.simulateClientConfirmation(auth.authId, "success");
    const capture = await provider.capture(auth.authId);
    expect(capture.status).toBe("captured");
  });

  it("updateAuthAmount changes a not-yet-confirmed amount and refuses afterwards", async () => {
    const auth = await provider.authorize("booking-1", 6800);

    const updated = await provider.updateAuthAmount(auth.authId, 7300);
    expect(updated.amountCents).toBe(7300);
    expect(updated.status).toBe("requires_action");
    expect(updated.clientSecret).toBeDefined();

    provider.simulateClientConfirmation(auth.authId, "success");
    await expect(provider.updateAuthAmount(auth.authId, 100)).rejects.toThrow(
      /cannot change the amount/,
    );
    // The confirmed hold kept the updated amount.
    expect((await provider.getAuth(auth.authId)).amountCents).toBe(7300);
  });

  it("cancelAuth voids a pending confirmation; getAuth then reports failed", async () => {
    const auth = await provider.authorize("booking-1", 6800);
    await provider.cancelAuth(auth.authId);

    expect((await provider.getAuth(auth.authId)).status).toBe("failed");
    expect(provider.simulateClientConfirmation.bind(provider, auth.authId, "success")).toThrow(
      /nothing to confirm/,
    );
  });

  it("default mode still authorizes instantly — dev funnel behavior unchanged", async () => {
    const instant = new FakePaymentProvider();
    const auth = await instant.authorize("booking-1", 6800);
    expect(auth.status).toBe("authorized");
    expect((await instant.getAuth(auth.authId)).status).toBe("authorized");
  });
});

describe("FakePaymentProvider.verifyWebhook", () => {
  const provider = new FakePaymentProvider();

  it("accepts the fixed dev signature and normalises the event", () => {
    const event = provider.verifyWebhook(
      JSON.stringify({
        id: "evt_1",
        type: "payment.captured",
        providerRef: "auth_000001",
        amountCents: 6800,
        bookingId: "booking-1",
      }),
      "fake-signature",
    );

    expect(event).toMatchObject({
      id: "evt_1",
      type: "payment.captured",
      providerRef: "auth_000001",
      amountCents: 6800,
      bookingId: "booking-1",
    });
  });

  it("rejects a wrong signature", () => {
    expect(() => provider.verifyWebhook("{}", "bad")).toThrow(WebhookVerificationError);
  });

  it("rejects a non-JSON payload", () => {
    expect(() => provider.verifyWebhook("not json", "fake-signature")).toThrow(
      WebhookVerificationError,
    );
  });

  it("rejects a payload missing required fields", () => {
    expect(() =>
      provider.verifyWebhook(JSON.stringify({ id: "evt" }), "fake-signature"),
    ).toThrow(/type, providerRef/);
  });
});

describe("createPaymentProvider", () => {
  it("returns the fake provider when asked", () => {
    expect(createPaymentProvider({ kind: "fake" }).name).toBe("fake");
  });

  it("constructs the Stripe provider without touching the network or validating the key", () => {
    const provider = createPaymentProvider({
      kind: "stripe",
      secretKey: "sk_test_placeholder",
    });
    expect(provider.name).toBe("stripe");
  });
});
