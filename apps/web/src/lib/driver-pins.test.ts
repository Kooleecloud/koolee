import { describe, expect, it } from "vitest";

import { driverPins, type PinnableCandidate } from "./driver-pins";

/**
 * The shortlist, as pins.
 *
 * Small enough to look correct and wrong in two ways that a screenshot would
 * not catch — a dropped driver and an unstable id — so it is pinned here.
 */

const at = (lat: number, lng: number) => ({ lat, lng });

function candidate(
  over: Partial<PinnableCandidate> & { shiftId: string },
): PinnableCandidate {
  return { givenName: "Driver", position: at(40.75, -73.99), ...over };
}

describe("driverPins", () => {
  it("maps a shortlist to pins keyed by SHIFT id", () => {
    const pins = driverPins(
      [
        candidate({ shiftId: "s-1", givenName: "Marcus", position: at(40.76, -73.98) }),
        candidate({ shiftId: "s-2", givenName: "Yara", position: at(40.74, -73.99) }),
      ],
      null,
    );

    expect(pins).toEqual([
      {
        id: "s-1",
        position: { lat: 40.76, lng: -73.98 },
        label: "Marcus",
        selected: false,
      },
      {
        id: "s-2",
        position: { lat: 40.74, lng: -73.99 },
        label: "Yara",
        selected: false,
      },
    ]);
  });

  /*
   * The id is the SELECTION TARGET and the key `LiveMap` reconciles markers
   * by. Anything else — an index, a user id — would make every refresh tear
   * the marker down and re-add it, which is the difference between a van that
   * drives across the map and one that blinks from block to block.
   */
  it("keys pins by the same id the selection form posts", () => {
    const pins = driverPins([candidate({ shiftId: "shift-abc" })], null);
    expect(pins[0]!.id).toBe("shift-abc");
  });

  /* --- the driver with no fix ----------------------------------------- */

  /*
   * NULL IS ORDINARY, not an error: a phone in a pocket stops reporting. That
   * driver keeps their card and is perfectly choosable; they simply have
   * nowhere to be drawn. Inventing a coordinate would put a van on a street it
   * has never been on, which is worse than an absent pin.
   */
  it("gives no pin to a driver who has never reported a position", () => {
    const pins = driverPins(
      [
        candidate({ shiftId: "has-fix" }),
        candidate({ shiftId: "no-fix", position: null }),
      ],
      null,
    );
    expect(pins.map((p) => p.id)).toEqual(["has-fix"]);
  });

  it("returns no pins at all when nobody has reported", () => {
    expect(driverPins([candidate({ shiftId: "a", position: null })], null)).toHaveLength(
      0,
    );
  });

  it("has nothing to draw for an empty shortlist", () => {
    expect(driverPins([], null)).toEqual([]);
  });

  /* --- what is highlighted -------------------------------------------- */

  it("marks exactly the selected shift", () => {
    const pins = driverPins(
      [candidate({ shiftId: "a" }), candidate({ shiftId: "b" })],
      "b",
    );
    expect(pins.map((p) => [p.id, p.selected])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  /*
   * A selection pointing at a driver who has since dropped out highlights
   * nothing rather than throwing. The component clears the id on the same
   * render, but the pin mapping must not depend on that having happened.
   */
  it("tolerates a selection for a driver no longer on the shortlist", () => {
    const pins = driverPins([candidate({ shiftId: "a" })], "gone");
    expect(pins.every((p) => p.selected === false)).toBe(true);
  });

  it("carries a missing name through rather than inventing one", () => {
    const pins = driverPins([candidate({ shiftId: "a", givenName: null })], null);
    expect(pins[0]!.label).toBeNull();
  });
});
