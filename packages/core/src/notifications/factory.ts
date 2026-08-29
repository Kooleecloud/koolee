import { ConsoleNotifier, type Notifier } from "./notifier";
import { ResendNotifier } from "./resend";

/**
 * Which notifier to use, injected rather than read from the environment —
 * same contract as `createPaymentProvider`. Apps resolve this from their own
 * validated `env.ts` (RESEND_API_KEY present → resend, absent → console) and
 * pass it in.
 *
 * Core takes credentials as values rather than reading `process.env`, with
 * one known exception: `auth/hash-destination.ts` reads `OTP_LOG_HMAC_KEY`
 * directly. See the note in payments/factory.ts.
 *
 * Constructing a notifier never opens a connection or validates a key, so
 * this is safe to call at module scope.
 */
export type NotifierConfig =
  | { kind: "console" }
  | { kind: "resend"; apiKey: string; from: string };

export function createNotifier(config: NotifierConfig): Notifier {
  if (config.kind === "resend") {
    return new ResendNotifier({ apiKey: config.apiKey, from: config.from });
  }
  return new ConsoleNotifier();
}
