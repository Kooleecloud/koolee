import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  confirmAirlineHandover,
  deliverToBagdrop,
  reportPickupException as coreReportPickupException,
  scanSealAtPickup,
  startPickupTravel,
} from "@koolee/core";
import { scanSealResponseSchema, stepResponseSchema } from "@koolee/api-contract";

import type * as Core from "@koolee/core";

import type { ApiContext } from "../context";
import { ApiHttpError } from "../errors";
import {
  deliver,
  handover,
  reportPickupException,
  scanSeal,
  startPickup,
} from "./pickup";

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  startPickupTravel: vi.fn(),
  scanSealAtPickup: vi.fn(),
  deliverToBagdrop: vi.fn(),
  confirmAirlineHandover: vi.fn(),
  reportPickupException: vi.fn(),
}));

const NOW = new Date("2026-09-27T12:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const BAG_ID = "33333333-3333-4333-8333-333333333333";

const ctx: ApiContext = {
  core: { db: {}, clock: { now: () => NOW } } as never,
  session: { kind: "agent", role: "agent", userId: USER_ID },
  identity: {
    session: { kind: "agent", role: "agent", userId: USER_ID },
    email: "driver@example.com",
    fullName: "Driver",
    avatarStoragePath: null,
    canDrive: true,
  } as never,
  supabase: { storage: { from: () => ({ createSignedUrl: vi.fn() }) } } as never,
  now: NOW,
};

const mocked = {
  start: vi.mocked(startPickupTravel),
  scan: vi.mocked(scanSealAtPickup),
  deliver: vi.mocked(deliverToBagdrop),
  handover: vi.mocked(confirmAirlineHandover),
  exception: vi.mocked(coreReportPickupException),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("task id guard", () => {
  it.each([
    ["startPickup", () => startPickup(ctx, "not-a-uuid", {})],
    ["scanSeal", () => scanSeal(ctx, "", { sealValue: "SEAL-1" })],
    ["deliver", () => deliver(ctx, "not-a-uuid", {})],
    ["handover", () => handover(ctx, "not-a-uuid", {})],
    [
      "reportPickupException",
      () => reportPickupException(ctx, "not-a-uuid", { reason: "vehicle_problem" }),
    ],
  ])("%s answers 404 for a non-uuid id without calling core", async (_name, run) => {
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(404);
    expect((error as ApiHttpError).body.error).toBe("not_found");
    for (const fn of Object.values(mocked)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("startPickup", () => {
  it("passes the session and position through and answers ok", async () => {
    mocked.start.mockResolvedValue({ ok: true });

    const body = await startPickup(ctx, TASK_ID, { lat: 40.7, lng: -73.9 });
    expect(stepResponseSchema.parse(body)).toEqual({ ok: true });
    expect(mocked.start).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: 40.7,
      lng: -73.9,
    });
  });

  it("treats an absent, null or exactly-zero coordinate as no fix", async () => {
    mocked.start.mockResolvedValue({ ok: true });

    await startPickup(ctx, TASK_ID, {});
    await startPickup(ctx, TASK_ID, { lat: null, lng: 0 });

    expect(mocked.start).toHaveBeenNthCalledWith(1, ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
    expect(mocked.start).toHaveBeenNthCalledWith(2, ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
  });

  it("turns a core refusal into a 422 carrying core's sentence", async () => {
    mocked.start.mockResolvedValue({ ok: false, error: "Booking is no longer active." });

    const error = await startPickup(ctx, TASK_ID, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(422);
    expect((error as ApiHttpError).body).toEqual({
      error: "refused",
      message: "Booking is no longer active.",
    });
  });
});

describe("scanSeal", () => {
  it("passes core's counts through as the response", async () => {
    mocked.scan.mockResolvedValue({
      ok: true,
      bagId: BAG_ID,
      scannedCount: 2,
      totalBags: 3,
      custodyTransferred: false,
    });

    const body = await scanSeal(ctx, TASK_ID, {
      sealValue: "SEAL-42",
      lat: 1.5,
      lng: 2.5,
    });
    expect(scanSealResponseSchema.parse(body)).toEqual({
      ok: true,
      bagId: BAG_ID,
      scannedCount: 2,
      totalBags: 3,
      custodyTransferred: false,
    });
    expect(mocked.scan).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      sealValue: "SEAL-42",
      lat: 1.5,
      lng: 2.5,
    });
  });

  it("lets a seal mismatch (ConflictError) propagate to the wrapper", async () => {
    mocked.scan.mockRejectedValue(
      new ConflictError("seal", "That seal is not on this booking."),
    );

    await expect(scanSeal(ctx, TASK_ID, { sealValue: "WRONG" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("deliver", () => {
  it("answers ok when core accepts", async () => {
    mocked.deliver.mockResolvedValue({ ok: true });

    await expect(deliver(ctx, TASK_ID, { lat: 3, lng: 4 })).resolves.toEqual({
      ok: true,
    });
    expect(mocked.deliver).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: 3,
      lng: 4,
    });
  });

  it("refuses with core's sentence", async () => {
    mocked.deliver.mockResolvedValue({ ok: false, error: "Scan every bag first." });

    const error = await deliver(ctx, TASK_ID, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).body).toEqual({
      error: "refused",
      message: "Scan every bag first.",
    });
  });
});

describe("handover", () => {
  it("answers ok when core accepts", async () => {
    mocked.handover.mockResolvedValue({ ok: true });

    await expect(handover(ctx, TASK_ID, {})).resolves.toEqual({ ok: true });
    expect(mocked.handover).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
  });

  it("refuses with core's sentence", async () => {
    mocked.handover.mockResolvedValue({
      ok: false,
      error: "Deliver to the bag drop first.",
    });

    const error = await handover(ctx, TASK_ID, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(422);
  });
});

describe("reportPickupException", () => {
  it("sends the reason and a trimmed note", async () => {
    mocked.exception.mockResolvedValue({ ok: true });

    await expect(
      reportPickupException(ctx, TASK_ID, {
        reason: "other",
        note: "  Counter closed early.  ",
        lat: 5,
        lng: 6,
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocked.exception).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      reason: "other",
      note: "Counter closed early.",
      lat: 5,
      lng: 6,
    });
  });

  it("omits the note key entirely when the note is blank", async () => {
    mocked.exception.mockResolvedValue({ ok: true });

    await reportPickupException(ctx, TASK_ID, { reason: "vehicle_problem", note: "   " });

    const input = mocked.exception.mock.calls[0]?.[2];
    expect(input).toEqual({
      taskId: TASK_ID,
      reason: "vehicle_problem",
      lat: null,
      lng: null,
    });
    expect(input && "note" in input).toBe(false);
  });

  it("refuses with core's sentence", async () => {
    mocked.exception.mockResolvedValue({ ok: false, error: "Describe what happened." });

    const error = await reportPickupException(ctx, TASK_ID, { reason: "other" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).body).toEqual({
      error: "refused",
      message: "Describe what happened.",
    });
  });
});
