import { HaversineEtaEstimator, type EtaEstimator } from "./eta";
import { GoogleRoutesEtaEstimator } from "./routes";

/**
 * Which ETA estimator to use, injected rather than read from the environment
 * — same contract as `createNotifier` and `createPaymentProvider`.
 *
 * Two kinds. The credentialled one carries its key as a VALUE in the config
 * union, exactly the way `payments: { kind: "stripe", secretKey }` does; an
 * earlier note here predicted it would have to arrive as a pre-built instance
 * instead, which turned out to be unnecessary — a plain `fetch` adapter needs
 * no client to construct and no Node-only library, so the declarative form
 * works and all three apps select it with one line.
 *
 * SELECTION IS BY KEY PRESENCE, resolved app-side: a key means Routes, no key
 * means haversine. A fresh clone with no Google account estimates exactly as
 * it always did.
 *
 * Constructing an estimator never opens a connection, so this is safe to call
 * at module scope.
 */
export type EtaEstimatorConfig =
  | { kind: "haversine" }
  | { kind: "google-routes"; apiKey: string; timeoutMs?: number };

export function createEtaEstimator(config: EtaEstimatorConfig): EtaEstimator {
  if (config.kind === "google-routes") {
    return new GoogleRoutesEtaEstimator({
      apiKey: config.apiKey,
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    });
  }
  return new HaversineEtaEstimator();
}
