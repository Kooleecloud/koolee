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
  it("keeps every pin between 400m and 2km of the door", () => {
    for (const ghost of ghostDrivers(BOOKING, PICKUP)) {
      const distance = metresBetween(PICKUP, ghost.position);
      expect(distance).toBeGreaterThanOrEqual(400);
      expect(distance).toBeLessThanOrEqual(2_000);
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
   * A named ghost is a fabricated person, which is a different and much worse
   * thing than an anonymous dot. Asserted rather than trusted to review.
   */
  it("never carries a name, and always declares itself a ghost", () => {
    for (const ghost of ghostDrivers(BOOKING, PICKUP)) {
      expect(ghost.label).toBeNull();
      expect(ghost.variant).toBe("ghost");
    }
  });

  it("drifts a little between steps, and reproducibly", () => {
    const still = ghostDrivers(BOOKING, PICKUP, 0);
    const drifted = ghostDrivers(BOOKING, PICKUP, 1);
    const again = ghostDrivers(BOOKING, PICKUP, 1);

    expect(drifted.map((g) => g.position)).toEqual(again.map((g) => g.position));
    expect(drifted[0]!.position).not.toEqual(still[0]!.position);

    // Idling in traffic, not crossing town. A placeholder that covers ground
    // invites somebody to follow it.
    const moved = metresBetween(still[0]!.position, drifted[0]!.position);
    expect(moved).toBeLessThanOrEqual(120);
  });

  it("survives a pickup near a pole without producing NaN", () => {
    for (const ghost of ghostDrivers(BOOKING, { lat: 89.999, lng: 0 })) {
      expect(Number.isFinite(ghost.position.lat)).toBe(true);
      expect(Number.isFinite(ghost.position.lng)).toBe(true);
    }
  });
});
