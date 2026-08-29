import { HaversineEtaEstimator, type EtaEstimator } from "./eta";

/**
 * Which ETA estimator to use, injected rather than read from the environment
 * — same contract as `createNotifier` and `createPaymentProvider`.
 *
 * One kind today. The union exists so that the day a routing provider lands,
 * the app-side change is a config value and not a search for call sites; a
 * credentialled provider would arrive as an `etaEstimator` INSTANCE passed to
 * `createRuntime`, the way the Inngest emitter does, because keys are
 * environment and core reads none.
 *
 * Constructing an estimator never opens a connection, so this is safe to call
 * at module scope.
 */
export type EtaEstimatorConfig = { kind: "haversine" };

export function createEtaEstimator(_config: EtaEstimatorConfig): EtaEstimator {
  return new HaversineEtaEstimator();
}
