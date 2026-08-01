import { FakePaymentProvider } from "./fake";
import { StripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

/**
 * Which provider to use, injected rather than read from the environment —
 * packages/core never touches `process.env`. Apps resolve this from their own
 * validated `env.ts` and pass it in.
 */
export type PaymentProviderConfig =
  | { kind: "fake"; currency?: string }
  | {
      kind: "stripe";
      secretKey: string;
      webhookSecret?: string;
      currency?: string;
    };

/**
 * Constructing a provider never opens a connection or validates a key, so this
 * is safe to call at module scope.
 */
export function createPaymentProvider(config: PaymentProviderConfig): PaymentProvider {
  if (config.kind === "stripe") {
    return new StripeProvider({
      secretKey: config.secretKey,
      ...(config.webhookSecret === undefined
        ? {}
        : { webhookSecret: config.webhookSecret }),
      ...(config.currency === undefined ? {} : { currency: config.currency }),
    });
  }

  return new FakePaymentProvider(
    config.currency === undefined ? {} : { currency: config.currency },
  );
}
