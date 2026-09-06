import { describe, expect, it } from "vitest";

import { bestCandidate } from "./driver-selection";
import type { DriverCandidate } from "./driver-selection";

/**
 * "Pick the best", proved without a database.
 *
 * The rule is a claim about a LIST — nearest by ETA, tie-broken by the
 * emptiest van — so it is provable in isolation, and it should be: the
 * selection it feeds is the ordinary `selectDriver`, whose transaction and
 * capacity recheck are already covered against real Postgres in
 * `driver-selection.integration.test.ts`. Nothing here needs a row.
 *
 * What these pin is that the shortcut agrees with the CARDS. A customer
 * looking at "about 15 min" and "about 25 min" and pressing a button labelled
 * "pick the best for me" must get the fifteen. A rule that quietly optimised
 * for something else — the widest van, the newest driver — would be a
 * different system wearing a shortcut's label.
 */

function candidate(
  over: Partial<DriverCandidate> & { shiftId: string },
): DriverCandidate {
  return {
    staffUserId: `u-${over.shiftId}`,
    givenName: "Driver",
    avatarStoragePath: null,
    truckName: "Van",
    bagCapacity: 10,
    reservedSpaces: 0,
    bagsOnBoard: 0,
    availableCapacity: 10,
    outOfZone: false,
    eta: null,
    position: null,
    ...over,
  } as DriverCandidate;
}

const eta = (minMinutes: number) => ({ minMinutes, maxMinutes: minMinutes + 10 });

describe("bestCandidate", () => {
  it("has no answer for an empty shortlist", () => {
    expect(bestCandidate([])).toBeNull();
  });

  it("takes the only candidate there is", () => {
    expect(bestCandidate([candidate({ shiftId: "a" })])?.shiftId).toBe("a");
  });

  it("takes the nearest by ETA, whatever order they arrive in", () => {
    const list = [
      candidate({ shiftId: "far", eta: eta(30) }),
      candidate({ shiftId: "near", eta: eta(8) }),
      candidate({ shiftId: "mid", eta: eta(17) }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("near");
    expect(bestCandidate([...list].reverse())?.shiftId).toBe("near");
  });

  /*
   * Compared on `minMinutes` because that is the number the card leads with.
   * Ranking on the pessimistic end would sometimes disagree with the two
   * ranges a customer is reading, which is the one thing a shortcut may not
   * do.
   */
  it("compares the optimistic end, the way the cards read", () => {
    const list = [
      candidate({ shiftId: "tight", eta: { minMinutes: 12, maxMinutes: 40 } }),
      candidate({ shiftId: "loose", eta: { minMinutes: 15, maxMinutes: 20 } }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("tight");
  });

  /* --- the tie-break -------------------------------------------------- */

  it("breaks an ETA tie on the emptiest van", () => {
    const list = [
      candidate({ shiftId: "loaded", eta: eta(10), bagsOnBoard: 6 }),
      candidate({ shiftId: "empty", eta: eta(10), bagsOnBoard: 1 }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("empty");
  });

  /*
   * DETERMINISTIC to the end. Two identical requests must reach the same
   * driver — an unstable "best" would send them to two different people and
   * the second would lose a race it never needed to enter.
   */
  it("breaks a full tie on shift id, stably", () => {
    const list = [
      candidate({ shiftId: "b", eta: eta(10), bagsOnBoard: 2 }),
      candidate({ shiftId: "a", eta: eta(10), bagsOnBoard: 2 }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("a");
    expect(bestCandidate([...list].reverse())?.shiftId).toBe("a");
  });

  /* --- drivers with no ETA -------------------------------------------- */

  /*
   * A null ETA means the driver has never pinged a position. There is no
   * honest way to rank an unknown against a number, so it never wins — but it
   * stays perfectly choosable by hand, which is why it is only ranked last
   * rather than filtered out of the shortlist.
   */
  it("never prefers a driver with no ETA over one with an ETA", () => {
    const list = [
      candidate({ shiftId: "silent", bagsOnBoard: 0 }),
      candidate({ shiftId: "known", eta: eta(45), bagsOnBoard: 9 }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("known");
  });

  it("still answers when nobody has an ETA, on the emptiest van", () => {
    const list = [
      candidate({ shiftId: "fuller", bagsOnBoard: 5 }),
      candidate({ shiftId: "emptier", bagsOnBoard: 2 }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("emptier");
  });

  /*
   * `listCandidateDrivers` widens past the pickup ZIP only when NOBODY in
   * zone is available, so a shortlist is either all in-zone or all out. There
   * is therefore no in-zone preference to apply here, and adding one would be
   * dead code that looked like a rule.
   */
  it("does not treat out-of-zone as a penalty, because a mixed list cannot occur", () => {
    const list = [
      candidate({ shiftId: "out", eta: eta(9), outOfZone: true }),
      candidate({ shiftId: "in", eta: eta(20), outOfZone: false }),
    ];
    expect(bestCandidate(list)?.shiftId).toBe("out");
  });

  it("does not mutate the list it was given", () => {
    const list = [
      candidate({ shiftId: "b", eta: eta(30) }),
      candidate({ shiftId: "a", eta: eta(5) }),
    ];
    bestCandidate(list);
    expect(list.map((c) => c.shiftId)).toEqual(["b", "a"]);
  });
});
