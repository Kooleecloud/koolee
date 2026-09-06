/**
 * The automated passport-validity seam.
 *
 * It lives beside the other injected seams (`payments/`, `notifications/`,
 * `extraction/`, `events/`) rather than inside `services/`, because
 * `config.ts` has to name its default and `config.ts` sits BELOW services in
 * this package's layering. Same reason `Notifier` is not in `services/`.
 *
 * Nothing in this slice performs a check. The interface exists so that adding
 * a paid vendor later is one new class plus one arm in the factory, and not a
 * change at every call site.
 */

export type PassportValidityVerdict = "not_checked" | "passed" | "failed";

export interface PassportValidityResult {
  status: PassportValidityVerdict;
  /** Which implementation produced the verdict. Null when none did. */
  provider: string | null;
}

/**
 * Takes a STORAGE PATH, returns a STATUS.
 *
 * That signature is the whole design. An implementation may read the image,
 * but what crosses this boundary is a verdict — never extracted fields. So no
 * vendor integration can quietly turn `passport_verifications` into a store
 * of passport data, which is the one thing that table must never become.
 */
export interface PassportValidityChecker {
  check(input: {
    bookingId: string;
    storagePath: string;
  }): Promise<PassportValidityResult>;
}

/**
 * The default, and the only implementation in this slice: returns
 * `not_checked` and never blocks anything.
 *
 * Deliberately not a stub that returns `passed`. A stub that passes writes a
 * lie into the database — a row claiming a check happened — and the manual
 * agent confirmation is the control that actually holds. An honest absence is
 * the correct value.
 */
export class NotCheckedValidityChecker implements PassportValidityChecker {
  async check(): Promise<PassportValidityResult> {
    return { status: "not_checked", provider: null };
  }
}
