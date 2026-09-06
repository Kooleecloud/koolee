import { NotCheckedValidityChecker, type PassportValidityChecker } from "./checker";

/**
 * Which validity checker to use, injected rather than read from the
 * environment — the same contract as `createNotifier` and
 * `createPaymentProvider`. Apps resolve it through their own validated
 * `env.ts` and hand the result to `createRuntime`.
 *
 * One member today. The union exists so that adding a vendor is a new arm
 * here plus an adapter class, rather than a change at every call site — which
 * is the only thing that justifies building a seam before you need it.
 */
export type PassportValidityCheckerConfig = { kind: "none" };

export function createPassportValidityChecker(
  _config: PassportValidityCheckerConfig,
): PassportValidityChecker {
  return new NotCheckedValidityChecker();
}
