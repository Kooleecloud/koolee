import { describe, expect, it } from "vitest";

import {
  buildIdentityGate,
  identityGateMessage,
  type VisitIdentityGate,
} from "./agent-visit";
import type { BookingAgreementState } from "./agreements";
import type { PassportVerification } from "@koolee/db";

/**
 * The identity gate's DERIVATION, tested purely.
 *
 * The integration tier cannot reach the interesting case. Migration 0024
 * freezes an agreement version once it is in effect, so a suite that seeds one
 * (every agent-visit suite does — the gate needs a "current" to resolve
 * against) cannot delete its way back to the day-zero state: the trigger
 * raises 23001, which is the guard working. This is a pure function, so it
 * gets a pure test.
 */

const NO_PASSPORT: PassportVerification | null = null;

function agreementState(
  overrides: Partial<BookingAgreementState>,
): BookingAgreementState {
  return {
    acceptedVersion: null,
    acceptance: null,
    currentVersion: null,
    accepted: false,
    ...overrides,
  };
}

/** Enough of a version row for the gate, which only checks for null-ness. */
const A_VERSION = { id: "v1", version: 1 } as BookingAgreementState["currentVersion"];

describe("the identity gate's blockers", () => {
  it("blames the customer only when there is something for them to accept", () => {
    const gate = buildIdentityGate(
      agreementState({ currentVersion: A_VERSION }),
      NO_PASSPORT,
    );
    expect(gate.blockers).toEqual(["agreement_not_accepted", "passport_not_confirmed"]);
    expect(identityGateMessage(gate)).toMatch(/customer has not accepted/i);
  });

  /**
   * NOTHING HAS EVER BEEN PUBLISHED. The gate must still refuse — failing
   * closed is the whole design — but the sentence an agent reads at a
   * doorstep has to name an ops failure rather than a customer's inaction.
   * There is no button for the customer to press, and telling the agent to
   * ask them for one is how a person gets blamed for someone else's mistake
   * while standing on their own doorstep at 6am.
   */
  it("names an absent agreement as its own blocker", () => {
    const gate = buildIdentityGate(agreementState({ currentVersion: null }), NO_PASSPORT);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain("no_agreement_published");
    expect(gate.blockers).not.toContain("agreement_not_accepted");

    const message = identityGateMessage(gate)!;
    expect(message).toMatch(/contact ops/i);
    expect(message).not.toMatch(/customer has not accepted/i);
  });

  it("says nothing about the agreement once it is accepted, whatever is current now", () => {
    // Pinning: a booking that accepted v1 stays clear after v2 publishes, and
    // stays clear even if the current-version lookup returns nothing.
    const gate = buildIdentityGate(
      agreementState({
        accepted: true,
        acceptedVersion: A_VERSION,
        currentVersion: null,
      }),
      NO_PASSPORT,
    );
    expect(gate.blockers).toEqual(["passport_not_confirmed"]);
  });

  it("passes only when both halves hold", () => {
    const gate: VisitIdentityGate = buildIdentityGate(
      agreementState({ accepted: true, acceptedVersion: A_VERSION }),
      { status: "agent_confirmed" } as PassportVerification,
    );
    expect(gate.passed).toBe(true);
    expect(identityGateMessage(gate)).toBeNull();
  });
});
