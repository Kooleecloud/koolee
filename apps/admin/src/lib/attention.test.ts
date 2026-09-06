import { describe, expect, it } from "vitest";
import type { BoardRow, LaunchReadiness, OpsDashboard, ShiftRow } from "@koolee/core";

import { buildAttention } from "./attention";

/**
 * The Overview's whole premise, in one function.
 *
 * The page it replaced was four stat cards, three of which read `0` on an
 * ordinary day — so its shape was identical whether everything was fine or the
 * fleet was on fire, and only a digit told you which. These tests pin the two
 * halves that fixed it: **a calm system produces an EMPTY list**, and a
 * problem produces exactly one entry, ordered by consequence.
 */

const CALM: OpsDashboard = {
  todayByStatus: [],
  unassignedToday: 0,
  awaitingDriverToday: 0,
  exceptionsOpen: 0,
};

const READY: LaunchReadiness = {
  ready: true,
  okCount: 4,
  items: [
    {
      key: "pricing",
      label: "Pricing rule active",
      status: "ok",
      detail: null,
      href: "/pricing",
    },
    {
      key: "agreement",
      label: "Booking agreement published",
      status: "ok",
      detail: null,
      href: "/agreements",
    },
    {
      key: "cutoffs",
      label: "Airline cutoffs verified",
      status: "ok",
      detail: null,
      href: "/cutoffs",
    },
    { key: "staff", label: "Active staff", status: "ok", detail: null, href: "/staff" },
  ],
};

const openShift = { shiftId: "s-1" } as ShiftRow;
const row = (over: Partial<BoardRow> = {}) => ({ atRisk: false, ...over }) as BoardRow;

function build(over: Partial<Parameters<typeof buildAttention>[0]> = {}) {
  return buildAttention({
    dashboard: CALM,
    readiness: READY,
    today: [],
    openShifts: [openShift],
    ...over,
  });
}

describe("buildAttention", () => {
  /* THE POINT OF THE WHOLE PAGE. Nothing wrong, nothing rendered. */
  it("says nothing at all when nothing is wrong", () => {
    expect(build()).toEqual([]);
  });

  it("does not treat a zero as news", () => {
    const items = build({
      dashboard: { ...CALM, todayByStatus: [{ status: "completed", count: 9 }] },
    });
    // Nine completed bookings is a fine day, not an item.
    expect(items).toEqual([]);
  });

  /* --- ordering is by consequence, not by which check ran first ------- */

  it("puts a blocked product above an urgent booking above unpicked work", () => {
    const items = build({
      dashboard: { ...CALM, exceptionsOpen: 1, unassignedToday: 2 },
      readiness: {
        ...READY,
        ready: false,
        okCount: 3,
        items: READY.items.map((item) =>
          item.key === "pricing"
            ? {
                ...item,
                status: "blocked" as const,
                detail: "Every quote is refusing right now.",
              }
            : item,
        ),
      },
    });

    expect(items.map((i) => i.level)).toEqual(["blocked", "urgent", "soon"]);
    expect(items[0]!.title).toBe("No pricing rule is active");
  });

  /*
   * A readiness label is a CHECKLIST phrase — "Pricing rule active" — which
   * reads correctly beside a tick and badly as an alarm. The alarm states the
   * absence.
   */
  it("states the absence rather than reusing the checklist label", () => {
    const items = build({
      readiness: {
        ...READY,
        ready: false,
        okCount: 3,
        items: READY.items.map((item) =>
          item.key === "agreement" ? { ...item, status: "blocked" as const } : item,
        ),
      },
    });
    expect(items[0]!.title).toBe("No booking agreement is published");
  });

  /*
   * UNVERIFIED CUTOFFS DO NOT APPEAR HERE AT ALL, and the first version got
   * this wrong: it raised them as a quiet note, so the identical sentence
   * showed in this panel AND in the readiness block three rows below. The
   * division is by TIME — this panel is what somebody does today, and
   * finishing the cutoffs is a job before opening.
   */
  it("leaves placeholder cutoffs to the readiness block entirely", () => {
    const items = build({
      dashboard: { ...CALM, exceptionsOpen: 1 },
      readiness: {
        ...READY,
        ready: false,
        okCount: 3,
        items: READY.items.map((item) =>
          item.key === "cutoffs"
            ? {
                ...item,
                status: "warn" as const,
                detail: "47 of 128 are still the seed's invented numbers.",
              }
            : item,
        ),
      },
    });
    expect(items.find((i) => i.id === "readiness:cutoffs")).toBeUndefined();
    // …while the genuine problem still shows.
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("exceptions");
  });

  /* --- the composite nobody would think to check ---------------------- */

  /*
   * NOBODY ON SHIFT is only a problem when there is sealed work waiting.
   * An empty road at 6am is ordinary, and so is a sealed booking mid-morning;
   * TOGETHER they are the one shape where a customer's bags sit on a doorstep
   * with literally nobody who could be chosen to collect them.
   */
  it("says nothing about an empty road when there is no work waiting", () => {
    expect(build({ openShifts: [] })).toEqual([]);
  });

  it("raises it once sealed bags are waiting on nobody", () => {
    const items = build({
      openShifts: [],
      dashboard: { ...CALM, awaitingDriverToday: 2 },
    });
    expect(items.find((i) => i.id === "no-shifts")).toMatchObject({ level: "urgent" });
  });

  it("stays quiet about the road when somebody IS out", () => {
    const items = build({ dashboard: { ...CALM, awaitingDriverToday: 2 } });
    expect(items.find((i) => i.id === "no-shifts")).toBeUndefined();
    // The sealed bookings are still worth a line — just a calmer one.
    expect(items.find((i) => i.id === "no-driver")).toMatchObject({ level: "soon" });
  });

  /* --- counts come from the rows, not from a counter ------------------ */

  it("counts at-risk bookings off the board rows it was given", () => {
    const items = build({
      today: [row({ atRisk: true }), row(), row({ atRisk: true })],
    });
    expect(items.find((i) => i.id === "at-risk")).toMatchObject({
      level: "urgent",
      title: "2 at risk today",
    });
  });

  it("pluralises a single stopped booking correctly", () => {
    const items = build({ dashboard: { ...CALM, exceptionsOpen: 1 } });
    expect(items[0]!.title).toBe("1 booking stopped");
  });

  it("every item carries somewhere to go and a verb", () => {
    const items = build({
      dashboard: {
        ...CALM,
        exceptionsOpen: 1,
        unassignedToday: 1,
        awaitingDriverToday: 1,
      },
      today: [row({ atRisk: true })],
    });
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) {
      expect(item.href).toMatch(/^\//);
      expect(item.action.length).toBeGreaterThan(0);
    }
  });
});
