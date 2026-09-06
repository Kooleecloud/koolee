import { describe, expect, it } from "vitest";

import { POSITION_GAP_MS, positionHealthOf } from "./position-health";

const NOW = new Date("2026-09-06T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/**
 * The database halves of this module need a database and are covered by the
 * integration tier. This is the rule both of them lean on, and the one worth
 * pinning without one: three states, not two.
 */
describe("positionHealthOf", () => {
  it("calls a recent fix live", () => {
    expect(positionHealthOf(ago(30_000), NOW).health).toBe("live");
  });

  /*
   * DELIBERATELY LOOSER THAN `POSITION_FRESH_MS` (90s). Ninety seconds is
   * "do not draw this pin as current" — a bar the ordinary rhythm of a phone
   * crosses at every red light in a tunnel. Alerting on it would page ops
   * several times an hour per driver and be ignored inside a day.
   */
  it("still calls a fix live at two minutes, past the map's freshness bar", () => {
    expect(positionHealthOf(ago(120_000), NOW).health).toBe("live");
  });

  it("calls it stale once the gap window has passed", () => {
    expect(positionHealthOf(ago(POSITION_GAP_MS + 1_000), NOW).health).toBe("stale");
  });

  /*
   * NEVER HEARD FROM IS ITS OWN STATE, not a very old fix. A dispatcher
   * responds differently: the first is a permissions or device problem to
   * solve before the driver leaves, the second is a driver to call.
   */
  it("distinguishes a phone that has never reported from one that stopped", () => {
    const silent = positionHealthOf(null, NOW);
    expect(silent.health).toBe("silent");
    expect(silent.lastSeenAt).toBeNull();
    expect(silent.silentForMs).toBeNull();
  });

  it("reports how long we have been blind", () => {
    expect(positionHealthOf(ago(300_000), NOW).silentForMs).toBe(300_000);
  });
});
