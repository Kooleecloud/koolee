import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotAuthorizedError } from "@koolee/core";
import { revalidatePath } from "next/cache";

import { resolveActionContext, type ApiContext } from "@/api/context";
import { ApiHttpError } from "@/api/errors";
import { endDriverShift, startDriverShift } from "@/api/handlers/shift";

import { endShiftAction, startShiftAction, type ShiftActionState } from "./shift-actions";

/**
 * The shift actions are form adapters over the handlers behind
 * `/api/v1/shift/start` and `/api/v1/shift/end`. What is proven here is the
 * adapter: the truck id reaches the handler, the layout is revalidated, and
 * refusals keep their sentence while crashes get the connection fallback.
 */

vi.mock("@/api/context", () => ({ resolveActionContext: vi.fn() }));
vi.mock("@/api/handlers/shift", () => ({
  startDriverShift: vi.fn(),
  endDriverShift: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TRUCK_ID = "9f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b";
const PREV: ShiftActionState = {};

const ctx = {
  core: { db: {} },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: new Date("2026-09-27T12:00:00.000Z"),
} as unknown as ApiContext;

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveActionContext).mockResolvedValue(ctx);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("startShiftAction", () => {
  it("hands the truck id to the shift handler and revalidates the layout", async () => {
    vi.mocked(startDriverShift).mockResolvedValue({ shift: null });

    await expect(startShiftAction(PREV, form({ truckId: TRUCK_ID }))).resolves.toEqual({
      ok: true,
    });

    expect(startDriverShift).toHaveBeenCalledWith(ctx, TRUCK_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["nothing picked", {}],
    ["a blank pick", { truckId: "" }],
    ["a value that is not a uuid", { truckId: "van-3" }],
  ])(
    'answers "Pick a truck first." for %s, before touching the session',
    async (_l, fields) => {
      await expect(startShiftAction(PREV, form(fields))).resolves.toEqual({
        error: "Pick a truck first.",
      });
      expect(resolveActionContext).not.toHaveBeenCalled();
      expect(startDriverShift).not.toHaveBeenCalled();
    },
  );

  it("shows a truck-already-out conflict verbatim", async () => {
    const conflict = new ConflictError(
      "shift",
      "That truck is already out with Nina Petrov.",
    );
    vi.mocked(startDriverShift).mockRejectedValue(conflict);

    await expect(startShiftAction(PREV, form({ truckId: TRUCK_ID }))).resolves.toEqual({
      error: conflict.message,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("shows a not-cleared-to-drive refusal verbatim", async () => {
    vi.mocked(startDriverShift).mockRejectedValue(
      new NotAuthorizedError("You're not cleared to drive."),
    );
    await expect(startShiftAction(PREV, form({ truckId: TRUCK_ID }))).resolves.toEqual({
      error: "You're not cleared to drive.",
    });
  });

  it("shows the context's own sentence when the session is gone", async () => {
    vi.mocked(resolveActionContext).mockRejectedValue(
      new ApiHttpError("not_authorized", "Please sign in again."),
    );
    await expect(startShiftAction(PREV, form({ truckId: TRUCK_ID }))).resolves.toEqual({
      error: "Please sign in again.",
    });
    expect(startDriverShift).not.toHaveBeenCalled();
  });

  it("falls back to the connection message for a crash", async () => {
    vi.mocked(startDriverShift).mockRejectedValue(new Error("boom"));
    await expect(startShiftAction(PREV, form({ truckId: TRUCK_ID }))).resolves.toEqual({
      error: "Couldn't start your shift. Check your connection and try again.",
    });
  });
});

describe("endShiftAction", () => {
  it("ends the shift through the handler and revalidates the layout", async () => {
    vi.mocked(endDriverShift).mockResolvedValue({ ok: true });

    await expect(endShiftAction(PREV, form())).resolves.toEqual({ ok: true });

    expect(endDriverShift).toHaveBeenCalledWith(ctx);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("shows the bags-still-on-board refusal verbatim", async () => {
    const refusal = new ConflictError("shift", "You still have 3 bags on board.");
    vi.mocked(endDriverShift).mockRejectedValue(refusal);
    await expect(endShiftAction(PREV, form())).resolves.toEqual({
      error: refusal.message,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to the connection message for a crash", async () => {
    vi.mocked(endDriverShift).mockRejectedValue(new Error("boom"));
    await expect(endShiftAction(PREV, form())).resolves.toEqual({
      error: "Couldn't end your shift. Check your connection and try again.",
    });
  });
});
