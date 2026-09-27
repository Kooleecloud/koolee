import { describe, expect, it } from "vitest";

import {
  countByHealth,
  fleetHealthOf,
  givenNameOf,
  lastSeenLabel,
  mergeFixes,
  pinLabelOf,
  readPositionChange,
  toMapDrivers,
  type FleetDriver,
} from "./drivers-map-model";

/**
 * The fleet map's pure rules. The component around them is exercised by the
 * production build and by eye; these are the parts that would fail QUIETLY —
 * a pin that jumps backwards, a health that never goes stale, a label that
 * hydrates differently — and so are the parts worth pinning.
 */

const NOW = Date.parse("2026-09-27T15:00:00Z");
const GAP = 120_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function driver(overrides: Partial<FleetDriver> = {}): FleetDriver {
  return {
    shiftId: "shift-1",
    staffUserId: "user-1",
    fullName: "Marcus Aurelius",
    truckName: "Van 2",
    bagsOnBoard: 3,
    position: { lat: 40.75, lng: -73.99 },
    recordedAt: ago(10_000),
    ...overrides,
  };
}

describe("fleetHealthOf", () => {
  // The same three verdicts as core's `positionHealthOf`, restated because
  // the core barrel cannot be imported from a client module.
  it("calls a recent fix live", () => {
    expect(fleetHealthOf(ago(30_000), NOW, GAP)).toBe("live");
  });

  it("is still live at exactly the gap, stale one millisecond past it", () => {
    expect(fleetHealthOf(ago(GAP), NOW, GAP)).toBe("live");
    expect(fleetHealthOf(ago(GAP + 1), NOW, GAP)).toBe("stale");
  });

  it("calls never-reported silent, and an unparseable stamp silent too", () => {
    expect(fleetHealthOf(null, NOW, GAP)).toBe("silent");
    expect(fleetHealthOf("not a date", NOW, GAP)).toBe("silent");
  });
});

describe("labels", () => {
  it("takes the first word of a name and falls back for an unnamed account", () => {
    expect(givenNameOf("Marcus Aurelius")).toBe("Marcus");
    expect(givenNameOf("  Yara  ")).toBe("Yara");
    expect(givenNameOf(null)).toBe("Driver");
    expect(givenNameOf("   ")).toBe("Driver");
  });

  it("puts the name and the truck on the pin", () => {
    expect(pinLabelOf({ fullName: "Ben Okri", truckName: "Sprinter" })).toBe(
      "Ben · Sprinter",
    );
  });

  it("says how long ago in words, with no locale formatting", () => {
    expect(lastSeenLabel(null, NOW)).toBe("no position yet");
    expect(lastSeenLabel(ago(20_000), NOW)).toBe("last seen just now");
    expect(lastSeenLabel(ago(3 * 60_000), NOW)).toBe("last seen 3 min ago");
    expect(lastSeenLabel(ago(59 * 60_000 + 20_000), NOW)).toBe("last seen 59 min ago");
    expect(lastSeenLabel(ago(70 * 60_000), NOW)).toBe("last seen 1 hr ago");
    expect(lastSeenLabel(ago(3 * 60 * 60_000), NOW)).toBe("last seen 3 hrs ago");
  });

  it("does not go negative when a phone's clock runs ahead of ours", () => {
    expect(lastSeenLabel(new Date(NOW + 30_000).toISOString(), NOW)).toBe(
      "last seen just now",
    );
  });
});

describe("readPositionChange", () => {
  const good = {
    eventType: "UPDATE",
    new: {
      staff_user_id: "user-1",
      lat: 40.76,
      lng: -73.98,
      recorded_at: "2026-09-27T14:59:50+00:00",
    },
  };

  it("reads the snake_case row off the wire", () => {
    expect(readPositionChange(good)).toEqual({
      staffUserId: "user-1",
      fix: {
        position: { lat: 40.76, lng: -73.98 },
        recordedAt: "2026-09-27T14:59:50+00:00",
      },
    });
  });

  it("returns null rather than throwing for anything it cannot read", () => {
    expect(readPositionChange(null)).toBeNull();
    expect(readPositionChange("nope")).toBeNull();
    expect(readPositionChange({})).toBeNull();
    // A DELETE carries `old` only.
    expect(readPositionChange({ eventType: "DELETE", old: good.new })).toBeNull();
    expect(readPositionChange({ new: { ...good.new, lat: "40.76" } })).toBeNull();
    expect(readPositionChange({ new: { ...good.new, lng: Number.NaN } })).toBeNull();
    expect(readPositionChange({ new: { ...good.new, recorded_at: "soon" } })).toBeNull();
    expect(readPositionChange({ new: { ...good.new, staff_user_id: "" } })).toBeNull();
  });
});

describe("mergeFixes", () => {
  it("moves a driver to a newer fix from the socket", () => {
    const fixes = new Map([
      ["user-1", { position: { lat: 40.8, lng: -73.9 }, recordedAt: ago(1_000) }],
    ]);
    const [merged] = mergeFixes([driver()], fixes);
    expect(merged!.position).toEqual({ lat: 40.8, lng: -73.9 });
    expect(merged!.recordedAt).toBe(ago(1_000));
  });

  /*
   * THE BACKWARDS JUMP. A refresh lands a roster rendered a moment before the
   * socket delivered a newer fix; if the roster won, the pin would step back
   * and forward again. The device's own timestamp decides.
   */
  it("keeps the server's fix when it is the newer one", () => {
    const fixes = new Map([
      ["user-1", { position: { lat: 40.8, lng: -73.9 }, recordedAt: ago(30_000) }],
    ]);
    const [merged] = mergeFixes([driver({ recordedAt: ago(5_000) })], fixes);
    expect(merged!.position).toEqual({ lat: 40.75, lng: -73.99 });
  });

  it("gives a never-reported driver their first fix", () => {
    const fixes = new Map([
      ["user-1", { position: { lat: 40.8, lng: -73.9 }, recordedAt: ago(1_000) }],
    ]);
    const [merged] = mergeFixes([driver({ position: null, recordedAt: null })], fixes);
    expect(merged!.position).toEqual({ lat: 40.8, lng: -73.9 });
  });

  it("ignores a fix for somebody no longer on the roster", () => {
    const fixes = new Map([
      ["user-gone", { position: { lat: 1, lng: 1 }, recordedAt: ago(1_000) }],
    ]);
    expect(mergeFixes([driver()], fixes)).toEqual([driver()]);
  });
});

describe("toMapDrivers", () => {
  it("draws a pin per positioned driver, keyed by shift, with the variant from health", () => {
    const pins = toMapDrivers(
      [
        driver(),
        driver({
          shiftId: "shift-2",
          staffUserId: "user-2",
          fullName: "Yara",
          truckName: "Van 5",
          recordedAt: ago(GAP + 60_000),
        }),
        driver({
          shiftId: "shift-3",
          staffUserId: "user-3",
          position: null,
          recordedAt: null,
        }),
      ],
      NOW,
      GAP,
      "shift-2",
    );
    expect(pins).toEqual([
      {
        id: "shift-1",
        position: { lat: 40.75, lng: -73.99 },
        label: "Marcus · Van 2",
        selected: false,
        variant: "live",
      },
      {
        id: "shift-2",
        position: { lat: 40.75, lng: -73.99 },
        label: "Yara · Van 5",
        selected: true,
        variant: "stale",
      },
    ]);
  });
});

describe("countByHealth", () => {
  it("counts the legend's three states", () => {
    const counts = countByHealth(
      [
        driver(),
        driver({ staffUserId: "u2", recordedAt: ago(GAP + 1) }),
        driver({ staffUserId: "u3", position: null, recordedAt: null }),
        driver({ staffUserId: "u4" }),
      ],
      NOW,
      GAP,
    );
    expect(counts).toEqual({ live: 2, stale: 1, silent: 1 });
  });
});
