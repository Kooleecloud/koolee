import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotAuthorizedError, recordDriverPosition } from "@koolee/core";
import { positionsResponseSchema } from "@koolee/api-contract";

import type * as Core from "@koolee/core";

import type { ApiContext } from "../context";
import { recordPositions } from "./positions";

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  recordDriverPosition: vi.fn(),
}));

const NOW = new Date("2026-09-27T12:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

const ctx: ApiContext = {
  core: { db: {}, clock: { now: () => NOW } } as never,
  session: { kind: "agent", role: "driver", userId: USER_ID },
  identity: {
    session: { kind: "agent", role: "driver", userId: USER_ID },
    email: "driver@example.com",
    fullName: "Driver",
    avatarStoragePath: null,
    canDrive: true,
  } as never,
  supabase: { storage: { from: () => ({ createSignedUrl: vi.fn() }) } } as never,
  now: NOW,
};

const record = vi.mocked(recordDriverPosition);

beforeEach(() => {
  vi.clearAllMocks();
  record.mockResolvedValue(undefined);
});

describe("recordPositions", () => {
  it("records a single fix under the caller's user id", async () => {
    const body = await recordPositions(ctx, { lat: 40.7, lng: -73.9 });
    expect(positionsResponseSchema.parse(body)).toEqual({ ok: true, accepted: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(ctx.core, {
      staffUserId: USER_ID,
      lat: 40.7,
      lng: -73.9,
    });
  });

  it("applies a batch one at a time, in the order given", async () => {
    const order: number[] = [];
    record.mockImplementation(async (_core, input) => {
      order.push(input.lat);
      // A later fix must not start before the earlier one settled.
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(-input.lat);
    });

    const result = await recordPositions(ctx, {
      fixes: [
        { lat: 1, lng: 10 },
        { lat: 2, lng: 20 },
        { lat: 3, lng: 30 },
      ],
    });

    expect(positionsResponseSchema.parse(result)).toEqual({ ok: true, accepted: 3 });
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it("parses recordedAt into a Date", async () => {
    await recordPositions(ctx, {
      lat: 1,
      lng: 2,
      recordedAt: "2026-09-27T11:59:55.000Z",
    });

    expect(record).toHaveBeenCalledWith(ctx.core, {
      staffUserId: USER_ID,
      lat: 1,
      lng: 2,
      recordedAt: new Date("2026-09-27T11:59:55.000Z"),
    });
  });

  it("omits the recordedAt key entirely when the fix has none", async () => {
    await recordPositions(ctx, { fixes: [{ lat: 1, lng: 2 }] });

    const input = record.mock.calls[0]?.[1];
    expect(input && "recordedAt" in input).toBe(false);
  });

  it("stops at the first failing fix and lets core's error propagate", async () => {
    record
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new NotAuthorizedError("Not on shift."));

    await expect(
      recordPositions(ctx, {
        fixes: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
          { lat: 3, lng: 3 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
