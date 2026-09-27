import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import { shiftResponseSchema, trucksResponseSchema } from "@koolee/api-contract";

const mocks = vi.hoisted(() => ({
  getActiveShift: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
  listTruckOptions: vi.fn(),
}));

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  getActiveShift: (...a: unknown[]) => mocks.getActiveShift(...a),
  startShift: (...a: unknown[]) => mocks.startShift(...a),
  endShift: (...a: unknown[]) => mocks.endShift(...a),
  listTruckOptions: (...a: unknown[]) => mocks.listTruckOptions(...a),
}));

import type { ApiContext } from "../context";
import { endDriverShift, readShift, readTrucks, startDriverShift } from "./shift";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: { tag: "db" }, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {
    email: "a@koolee.local",
    fullName: null,
    avatarStoragePath: null,
    canDrive: true,
  },
  supabase: {},
  now: NOW,
} as unknown as ApiContext;

const TRUCK = {
  id: "9f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
  name: "Van 3",
  bagCapacity: 12,
  reservedSpaces: 2,
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
};
const ACTIVE = {
  shift: {
    id: "1f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
    staffUserId: "user-1",
    truckId: TRUCK.id,
    startedAt: new Date("2026-09-27T08:00:00.000Z"),
    startedByUserId: null,
    endedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  truck: TRUCK,
  bagsOnBoard: 3,
};

describe("shift handlers", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
  });

  it("serialises the active shift to the contract, dates as ISO strings", async () => {
    mocks.getActiveShift.mockResolvedValue(ACTIVE);
    const body = await readShift(ctx);
    expect(mocks.getActiveShift).toHaveBeenCalledWith(ctx.core.db, "user-1");
    expect(shiftResponseSchema.parse(body)).toEqual({
      shift: {
        id: ACTIVE.shift.id,
        truck: {
          id: TRUCK.id,
          name: "Van 3",
          bagCapacity: 12,
          reservedSpaces: 2,
          active: true,
        },
        bagsOnBoard: 3,
        startedAt: "2026-09-27T08:00:00.000Z",
      },
    });
  });

  it("answers null when off shift", async () => {
    mocks.getActiveShift.mockResolvedValue(null);
    expect(await readShift(ctx)).toEqual({ shift: null });
  });

  it("starts a shift for the session's own user and returns it", async () => {
    mocks.startShift.mockResolvedValue({ ...ACTIVE, bagsOnBoard: 0 });
    const body = await startDriverShift(ctx, TRUCK.id);
    expect(mocks.startShift).toHaveBeenCalledWith(ctx.core, {
      staffUserId: "user-1",
      truckId: TRUCK.id,
    });
    expect(shiftResponseSchema.parse(body).shift?.bagsOnBoard).toBe(0);
  });

  it("lets a core refusal on start propagate untouched", async () => {
    const error = new Error("already on shift");
    mocks.startShift.mockRejectedValue(error);
    await expect(startDriverShift(ctx, TRUCK.id)).rejects.toBe(error);
  });

  it("ends the shift and answers ok", async () => {
    mocks.endShift.mockResolvedValue({ shift: ACTIVE.shift });
    expect(await endDriverShift(ctx)).toEqual({ ok: true });
    expect(mocks.endShift).toHaveBeenCalledWith(ctx.core, { staffUserId: "user-1" });
  });

  it("lists trucks with who holds them", async () => {
    mocks.listTruckOptions.mockResolvedValue([
      { ...TRUCK, heldByUserId: null },
      {
        ...TRUCK,
        id: "8f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
        name: "Van 4",
        heldByUserId: "7f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
      },
    ]);
    const body = trucksResponseSchema.parse(await readTrucks(ctx));
    expect(body.trucks.map((t) => [t.name, t.heldByUserId])).toEqual([
      ["Van 3", null],
      ["Van 4", "7f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b"],
    ]);
  });
});
