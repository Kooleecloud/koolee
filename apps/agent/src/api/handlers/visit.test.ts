import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import {
  arriveAtVisit,
  completeVerificationVisit,
  confirmVisitIdentity,
  getVisitContext,
  recordAgentCapture,
  recordBagSealed,
  reportVisitException as coreReportVisitException,
} from "@koolee/core";

import type { ApiContext } from "../context";
import { ApiHttpError } from "../errors";
import {
  arrive,
  capturePassport,
  completeVisit,
  confirmPassport,
  reportVisitException,
  sealBag,
} from "./visit";

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  arriveAtVisit: vi.fn(),
  completeVerificationVisit: vi.fn(),
  confirmVisitIdentity: vi.fn(),
  getVisitContext: vi.fn(),
  recordAgentCapture: vi.fn(),
  recordBagSealed: vi.fn(),
  reportVisitException: vi.fn(),
}));

const NOW = new Date("2026-09-27T08:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "00000000-0000-4000-8000-000000000002";
const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const BAG_ID = "00000000-0000-4000-8000-000000000004";

const createSignedUrl = vi.fn();

function fakeContext(): ApiContext {
  return {
    core: { db: {}, clock: { now: () => NOW } } as unknown as ApiContext["core"],
    session: { kind: "agent", role: "agent", userId: USER_ID } as ApiContext["session"],
    identity: {} as ApiContext["identity"],
    supabase: {
      storage: { from: () => ({ createSignedUrl }) },
    } as unknown as ApiContext["supabase"],
    now: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed" },
    error: null,
  });
});

describe("task id guard", () => {
  it.each([
    ["", "empty"],
    ["not-a-uuid", "malformed"],
    ["00000000-0000-4000-8000-00000000000", "one character short"],
  ])("answers 404 for %j (%s) without touching core or storage", async (taskId) => {
    const ctx = fakeContext();
    const err = await arrive(ctx, taskId, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(404);
    expect((err as ApiHttpError).body.error).toBe("not_found");
    expect(arriveAtVisit).not.toHaveBeenCalled();

    const sealErr = await sealBag(ctx, taskId, {
      bagId: BAG_ID,
      sealId: "SEAL-1",
      weightKg: 1,
      photoPath: `bags/${BAG_ID}/photo.jpg`,
    }).catch((e: unknown) => e);
    expect((sealErr as ApiHttpError).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordBagSealed).not.toHaveBeenCalled();

    const captureErr = await capturePassport(ctx, taskId, {
      storagePath: `passports/${BOOKING_ID}/photo.jpg`,
    }).catch((e: unknown) => e);
    expect((captureErr as ApiHttpError).status).toBe(404);
    expect(getVisitContext).not.toHaveBeenCalled();
  });
});

describe("arrive", () => {
  it("records arrival with the device position and answers ok", async () => {
    vi.mocked(arriveAtVisit).mockResolvedValue({} as never);
    const ctx = fakeContext();
    await expect(arrive(ctx, TASK_ID, { lat: 51.5, lng: -0.12 })).resolves.toEqual({
      ok: true,
    });
    expect(arriveAtVisit).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: 51.5,
      lng: -0.12,
    });
  });

  it("treats 0, null and absent coordinates as no fix", async () => {
    vi.mocked(arriveAtVisit).mockResolvedValue({} as never);
    const ctx = fakeContext();
    await arrive(ctx, TASK_ID, { lat: 0, lng: null });
    expect(arriveAtVisit).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
    await arrive(ctx, TASK_ID, {});
    expect(arriveAtVisit).toHaveBeenLastCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
  });

  it("lets a core error propagate untouched", async () => {
    const boom = new Error("nope");
    vi.mocked(arriveAtVisit).mockRejectedValue(boom);
    await expect(arrive(fakeContext(), TASK_ID, {})).rejects.toBe(boom);
  });
});

describe("capturePassport", () => {
  const goodPath = `passports/${BOOKING_ID}/photo.jpg`;

  beforeEach(() => {
    vi.mocked(getVisitContext).mockResolvedValue({
      booking: { id: BOOKING_ID },
    } as never);
    vi.mocked(recordAgentCapture).mockResolvedValue({} as never);
  });

  it("checks assignment, prefix and existence, then records the capture", async () => {
    const ctx = fakeContext();
    await expect(
      capturePassport(ctx, TASK_ID, { storagePath: goodPath }),
    ).resolves.toEqual({ ok: true });
    expect(getVisitContext).toHaveBeenCalledWith(ctx.core.db, ctx.session, TASK_ID, NOW);
    expect(createSignedUrl).toHaveBeenCalledWith(goodPath, 60);
    expect(recordAgentCapture).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      storagePath: goodPath,
    });
  });

  it("refuses a path outside the booking's prefix before touching storage or core", async () => {
    const err = await capturePassport(fakeContext(), TASK_ID, {
      storagePath: "passports/other-booking/photo.jpg",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).body.error).toBe("invalid_input");
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordAgentCapture).not.toHaveBeenCalled();
  });

  it("refuses a path whose object does not exist, without the core write", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });
    const err = await capturePassport(fakeContext(), TASK_ID, {
      storagePath: goodPath,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).body.error).toBe("invalid_input");
    expect(recordAgentCapture).not.toHaveBeenCalled();
  });

  it("does not check storage when the task is not this agent's", async () => {
    const notFound = new Error("Verification task not found");
    vi.mocked(getVisitContext).mockRejectedValue(notFound);
    await expect(
      capturePassport(fakeContext(), TASK_ID, { storagePath: goodPath }),
    ).rejects.toBe(notFound);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordAgentCapture).not.toHaveBeenCalled();
  });
});

describe("confirmPassport", () => {
  it("confirms identity and answers ok", async () => {
    vi.mocked(confirmVisitIdentity).mockResolvedValue({} as never);
    const ctx = fakeContext();
    await expect(confirmPassport(ctx, TASK_ID, { lat: 1, lng: 2 })).resolves.toEqual({
      ok: true,
    });
    expect(confirmVisitIdentity).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: 1,
      lng: 2,
    });
  });
});

describe("sealBag", () => {
  const body = {
    bagId: BAG_ID,
    sealId: "SEAL-1",
    weightKg: 12.5,
    photoPath: `bags/${BAG_ID}/photo.jpg`,
    lat: 1,
    lng: 2,
  };

  beforeEach(() => {
    vi.mocked(getVisitContext).mockResolvedValue({
      booking: { id: BOOKING_ID },
    } as never);
    vi.mocked(recordBagSealed).mockResolvedValue({} as never);
  });

  it("resolves the assignment before it probes storage, so a stranger gets a 404", async () => {
    vi.mocked(getVisitContext).mockRejectedValue(
      new Error("Verification task not found"),
    );
    await expect(sealBag(fakeContext(), TASK_ID, body)).rejects.toThrow(/not found/);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordBagSealed).not.toHaveBeenCalled();
  });

  it("verifies the photo then records the seal with all evidence", async () => {
    const ctx = fakeContext();
    await expect(sealBag(ctx, TASK_ID, body)).resolves.toEqual({ ok: true });
    expect(createSignedUrl).toHaveBeenCalledWith(body.photoPath, 60);
    expect(recordBagSealed).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      bagId: BAG_ID,
      sealId: "SEAL-1",
      weightKg: 12.5,
      photoPath: body.photoPath,
      lat: 1,
      lng: 2,
    });
  });

  it("refuses a photo outside the bag's prefix without touching storage or core", async () => {
    const err = await sealBag(fakeContext(), TASK_ID, {
      ...body,
      photoPath: "bags/another-bag/photo.jpg",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).body).toMatchObject({
      error: "invalid_input",
      field: "photoPath",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordBagSealed).not.toHaveBeenCalled();
  });

  it("refuses a missing photo object without the core write", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });
    const err = await sealBag(fakeContext(), TASK_ID, body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).body).toMatchObject({
      error: "invalid_input",
      field: "photoPath",
    });
    expect(recordBagSealed).not.toHaveBeenCalled();
  });
});

describe("completeVisit", () => {
  it("answers ok when core completes the visit", async () => {
    vi.mocked(completeVerificationVisit).mockResolvedValue({ ok: true });
    const ctx = fakeContext();
    await expect(completeVisit(ctx, TASK_ID, {})).resolves.toEqual({ ok: true });
    expect(completeVerificationVisit).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      lat: null,
      lng: null,
    });
  });

  it("turns a core refusal into a 422 carrying core's sentence", async () => {
    vi.mocked(completeVerificationVisit).mockResolvedValue({
      ok: false,
      error: "Seal every bag first.",
    });
    const err = await completeVisit(fakeContext(), TASK_ID, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(422);
    expect((err as ApiHttpError).body).toEqual({
      error: "refused",
      message: "Seal every bag first.",
    });
  });
});

describe("reportVisitException", () => {
  it("passes the reason, a trimmed note and the position through", async () => {
    vi.mocked(coreReportVisitException).mockResolvedValue({ ok: true });
    const ctx = fakeContext();
    await expect(
      reportVisitException(ctx, TASK_ID, {
        reason: "other",
        note: "  Dog.  ",
        lat: 3,
        lng: 4,
      }),
    ).resolves.toEqual({ ok: true });
    expect(coreReportVisitException).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      reason: "other",
      note: "Dog.",
      lat: 3,
      lng: 4,
    });
  });

  it("omits the note key entirely when it is blank", async () => {
    vi.mocked(coreReportVisitException).mockResolvedValue({ ok: true });
    const ctx = fakeContext();
    await reportVisitException(ctx, TASK_ID, {
      reason: "customer_not_home",
      note: "   ",
    });
    expect(coreReportVisitException).toHaveBeenCalledWith(ctx.core, ctx.session, {
      taskId: TASK_ID,
      reason: "customer_not_home",
      lat: null,
      lng: null,
    });
  });

  it("turns a core refusal into a 422", async () => {
    vi.mocked(coreReportVisitException).mockResolvedValue({
      ok: false,
      error: "Describe what happened.",
    });
    const err = await reportVisitException(fakeContext(), TASK_ID, {
      reason: "other",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as ApiHttpError).status).toBe(422);
    expect((err as ApiHttpError).body.message).toBe("Describe what happened.");
  });
});
