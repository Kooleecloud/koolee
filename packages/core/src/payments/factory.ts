import { FakePaymentProvider } from "./fake";
import { StripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

/**
 * Which provider to use, injected rather than read from the environment —
 * apps resolve this from their own validated `env.ts` and pass it in.
 *
 * The rule this serves is "core takes credentials as values, never from the
 * process environment". It holds everywhere except ONE known site:
 * `auth/hash-destination.ts` reads `OTP_LOG_HMAC_KEY` directly and throws
 * when it is unset. That read is deliberate and predates this comment; it is
 * named here so the rule reads as a rule with an exception rather than as a
 * claim that is quietly false.
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
 * The fake provider's ledger is in-memory, and apps build a fresh
 * `CoreConfig` per request — a per-request instance would forget every
 * authorization before capture time. One shared instance per process gives
 * credential-less dev a working authorize → capture → refund flow. Tests
 * construct `new FakePaymentProvider()` directly and are unaffected.
 */
let sharedFakeProvider: FakePaymentProvider | undefined;

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

  sharedFakeProvider ??= new FakePaymentProvider({
    ...(config.currency === undefined ? {} : { currency: config.currency }),
    // Ids must be unique ACROSS dev-server restarts, not just within one: the
    // ledger is per-process but the payments table persists, so a restarted
    // process re-minting `auth_000001` would collide with an old row's
    // (provider, provider_ref) key and the insert would silently no-op.
    // Tests construct their providers directly (deterministic counter) and
    // are unaffected.
    idFactory: perProcessIdFactory(),
  });
  return sharedFakeProvider;
}

function perProcessIdFactory(): (prefix: string) => string {
  const runId = crypto.randomUUID().slice(0, 8);
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix}_${runId}_${String(counter).padStart(6, "0")}`;
  };
}
