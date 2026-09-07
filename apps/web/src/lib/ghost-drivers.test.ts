import { describe, expect, it } from "vitest";

import { ghostDrivers } from "./ghost-drivers";

const PICKUP = { lat: 40.7505, lng: -73.9877 };
const BOOKING = "3f8c1a2e-0000-4000-8000-000000000001";

/** Great-circle distance in metres, good enough at city scale. */
function metresBetween(a: typeof PICKUP, b: typeof PICKUP): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("ghostDrivers", () => {
  /*
   * THE PROPERTY THAT MATTERS MOST. The trip page is `force-dynamic` and
   * re-renders every few seconds while somebody waits for a shortlist. Pins
   * placed with `Math.random()` would land on new streets each time — vans
   * teleporting around the neighbourhood, which reads as broken rather than
   * as busy.
   */
  it("places the same pins for the same booking, every time", () => {
    const a = ghostDrivers(BOOKING, PICKUP);
    const b = ghostDrivers(BOOKING, PICKUP);
    expect(a.map((g) => g.position)).toEqual(b.map((g) => g.position));
  });

  it("places different pins for different bookings", () => {
    const a = ghostDrivers(BOOKING, PICKUP);
    const b = ghostDrivers("a-different-booking", PICKUP);
    expect(a[0]!.position).not.toEqual(b[0]!.position);
  });

  /*
   * The lower bound is doing real work: a placeholder sitting on top of the
   * pickup pin — the one pin on this map that means something — is worse than
   * no placeholder at all.
   */
  it("keeps every pin between 600m and 1.6km of the door", () => {
    for (const ghost of ghostDrivers(BOOKING, PICKUP)) {
      const distance = metresBetween(PICKUP, ghost.position);
      expect(distance).toBeGreaterThanOrEqual(600);
      expect(distance).toBeLessThanOrEqual(1_600);
    }
  });

  /* Three bearings drawn at random land in one quadrant often enough to look
     like a bug. Each ghost owns a sector of the compass. */
  it("spreads pins around the door rather than clustering them", () => {
    const ghosts = ghostDrivers(BOOKING, PICKUP);
    const bearings = ghosts.map((g) =>
      Math.atan2(g.position.lng - PICKUP.lng, g.position.lat - PICKUP.lat),
    );
    const spread = Math.max(...bearings) - Math.min(...bearings);
    expect(spread).toBeGreaterThan(Math.PI / 2);
  });

  /*
   * A MASKED INITIAL IS NOT A NAME. The pin looks like the van it stands in
   * for — same pill, same glyph — so the label is the only thing separating
   * "still looking" from "here is your driver", and it has to read as withheld
   * rather than invented. Asserted rather than trusted to review, because a
   * future tidy-up that drops the asterisks would fabricate a person.
   */
  it("labels every ghost with a masked initial, never a name", () => {
    for (const ghost of ghostDrivers(BOOKING, PICKUP)) {
      expect(ghost.label).toMatch(/^[A-Z]\*{4}$/);
      expect(ghost.variant).toBe("ghost");
    }
  });

  it("keeps the masked label stable for a booking", () => {
    expect(ghostDrivers(BOOKING, PICKUP).map((g) => g.label)).toEqual(
      ghostDrivers(BOOKING, PICKUP).map((g) => g.label),
    );
  });

  /*
   * THEY DO NOT MOVE. Each pin used to drift on a shared counter, so all three
   * set off at the same instant in the same direction — which looked less like
   * traffic than standing still does. The pulse ring is the motion now.
   */
  it("returns the same positions however many times it is called", () => {
    const a = ghostDrivers(BOOKING, PICKUP);
    const b = ghostDrivers(BOOKING, PICKUP);
    const c = ghostDrivers(BOOKING, PICKUP);
    expect(a.map((g) => g.position)).toEqual(b.map((g) => g.position));
    expect(b.map((g) => g.position)).toEqual(c.map((g) => g.position));
  });

  it("survives a pickup near a pole without producing NaN", () => {
    for (const ghost of ghostDrivers(BOOKING, { lat: 89.999, lng: 0 })) {
      expect(Number.isFinite(ghost.position.lat)).toBe(true);
      expect(Number.isFinite(ghost.position.lng)).toBe(true);
    }
  });
});
