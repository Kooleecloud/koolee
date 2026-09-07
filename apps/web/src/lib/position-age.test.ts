import { describe, expect, it } from "vitest";

import { positionAgoLabel } from "./position-age";

const NOW = new Date("2026-09-06T15:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("positionAgoLabel", () => {
  it("says nothing when there has never been a fix", () => {
    expect(positionAgoLabel(null, NOW)).toBeNull();
  });

  /*
   * Coarse on purpose. A number that flickers between renders draws the eye
   * to itself, and nobody watching a van needs seconds.
   */
  it("calls anything under 90 seconds 'just now'", () => {
    expect(positionAgoLabel(ago(5), NOW)).toBe("just now");
    expect(positionAgoLabel(ago(89), NOW)).toBe("just now");
  });

  it("counts minutes up to an hour", () => {
    expect(positionAgoLabel(ago(240), NOW)).toBe("4 min ago");
    expect(positionAgoLabel(ago(1_800), NOW)).toBe("30 min ago");
  });

  it("switches to hours, then days", () => {
    expect(positionAgoLabel(ago(3_600), NOW)).toBe("an hour ago");
    expect(positionAgoLabel(ago(4 * 3_600), NOW)).toBe("4 hours ago");
    expect(positionAgoLabel(ago(24 * 3_600), NOW)).toBe("yesterday");
    expect(positionAgoLabel(ago(3 * 24 * 3_600), NOW)).toBe("3 days ago");
  });

  /*
   * A DEVICE CLOCK THAT IS WRONG, not a position from the future. Worth an
   * assertion because the naive arithmetic prints "-3 min ago" on a phone
   * whose time is off by a few minutes, which is not rare.
   */
  it("never prints a negative for a fix stamped in the future", () => {
    expect(positionAgoLabel(new Date(NOW.getTime() + 120_000), NOW)).toBe("just now");
  });
});
