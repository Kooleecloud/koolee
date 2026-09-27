import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import { BookingNotActionableError, ConflictError, getVisitContext } from "@koolee/core";
import { revalidatePath } from "next/cache";

import { resolveActionContext, type ApiContext } from "@/api/context";
import { ApiHttpError, refused } from "@/api/errors";
import {
  deliver,
  handover,
  reportPickupException,
  scanSeal,
  startPickup,
} from "@/api/handlers/pickup";
import {
  arrive,
  capturePassport,
  completeVisit,
  confirmPassport,
  reportVisitException,
  sealBag,
} from "@/api/handlers/visit";
import { uploadPassportPhoto } from "@/lib/passport-photos";

import {
  arriveAction,
  capturePassportAction,
  completeVisitAction,
  confirmHandoverAction,
  confirmPassportAction,
  deliverToBagdropAction,
  reportExceptionAction,
  reportPickupExceptionAction,
  scanSealAction,
  sealBagAction,
  startPickupTravelAction,
  type VisitActionState,
} from "./actions";

/**
 * WHAT THIS FILE PROVES: every server action is a form adapter over the SAME
 * handler the native app reaches through `/api/v1` — nothing about a driver
 * step is decided here. So each action is checked for exactly four things:
 * the parsed contract body reaches the right handler, `{ ok: true }` and the
 * revalidation follow, a refusal (ApiHttpError or CoreError) keeps its own
 * sentence, and anything else becomes the step's connection fallback. The
 * handlers themselves are proven in `src/api/handlers/*.test.ts`.
 */

vi.mock("@/api/context", () => ({ resolveActionContext: vi.fn() }));
vi.mock("@/api/handlers/visit", () => ({
  arrive: vi.fn(),
  capturePassport: vi.fn(),
  completeVisit: vi.fn(),
  confirmPassport: vi.fn(),
  reportVisitException: vi.fn(),
  sealBag: vi.fn(),
}));
vi.mock("@/api/handlers/pickup", () => ({
  deliver: vi.fn(),
  handover: vi.fn(),
  reportPickupException: vi.fn(),
  scanSeal: vi.fn(),
  startPickup: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/passport-photos", () => ({ uploadPassportPhoto: vi.fn() }));
vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  getVisitContext: vi.fn(),
}));

const NOW = new Date("2026-09-27T08:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "00000000-0000-4000-8000-000000000002";
const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const BAG_ID = "00000000-0000-4000-8000-000000000004";
const PREV: VisitActionState = {};

const upload = vi.fn();

function fakeContext(): ApiContext {
  return {
    core: {
      db: { tag: "db" },
      clock: { now: () => NOW },
    } as unknown as ApiContext["core"],
    session: { kind: "agent", role: "agent", userId: USER_ID } as ApiContext["session"],
    identity: {} as ApiContext["identity"],
    supabase: {
      storage: { from: vi.fn(() => ({ upload })) },
    } as unknown as ApiContext["supabase"],
    now: NOW,
  };
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function photo(type = "image/jpeg", bytes = 3): File {
  return new File([new Uint8Array(bytes)], "photo", { type });
}

const AT_DOOR = { taskId: TASK_ID, lat: "51.5", lng: "-0.12" };
const GPS = { lat: 51.5, lng: -0.12 };

let ctx: ApiContext;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  ctx = fakeContext();
  vi.mocked(resolveActionContext).mockResolvedValue(ctx);
  upload.mockResolvedValue({ data: { path: "x" }, error: null });
  vi.mocked(getVisitContext).mockResolvedValue({
    booking: { id: BOOKING_ID },
  } as unknown as Awaited<ReturnType<typeof getVisitContext>>);
  vi.mocked(uploadPassportPhoto).mockResolvedValue(`passports/${BOOKING_ID}/new.jpg`);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ------------------------------------------------------------------ */
/* The position-only steps share one shape                             */
/* ------------------------------------------------------------------ */

type Action = (prev: VisitActionState, form: FormData) => Promise<VisitActionState>;

const positionSteps: [string, Action, ReturnType<typeof vi.fn>, string][] = [
  ["arriveAction", arriveAction, vi.mocked(arrive), "Couldn't record your arrival."],
  [
    "confirmPassportAction",
    confirmPassportAction,
    vi.mocked(confirmPassport),
    "Couldn't confirm the passport.",
  ],
  [
    "completeVisitAction",
    completeVisitAction,
    vi.mocked(completeVisit),
    "Couldn't complete the visit.",
  ],
  [
    "startPickupTravelAction",
    startPickupTravelAction,
    vi.mocked(startPickup),
    "Couldn't start the pickup.",
  ],
  [
    "deliverToBagdropAction",
    deliverToBagdropAction,
    vi.mocked(deliver),
    "Couldn't record the drop-off.",
  ],
  [
    "confirmHandoverAction",
    confirmHandoverAction,
    vi.mocked(handover),
    "Couldn't close the job out.",
  ],
];

describe.each(positionSteps)("%s", (_name, action, handler, fallback) => {
  it("hands the contract Gps body to its handler and revalidates the task", async () => {
    handler.mockResolvedValue({ ok: true });

    await expect(action(PREV, form(AT_DOOR))).resolves.toEqual({ ok: true });

    expect(handler).toHaveBeenCalledWith(ctx, TASK_ID, GPS);
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it('treats a "0" coordinate as no fix, like the app', async () => {
    handler.mockResolvedValue({ ok: true });
    await action(PREV, form({ taskId: TASK_ID, lat: "0", lng: "" }));
    expect(handler).toHaveBeenCalledWith(ctx, TASK_ID, { lat: null, lng: null });
  });

  it("shows a handler refusal verbatim and does not revalidate", async () => {
    handler.mockRejectedValue(refused("Your bags are with the airline."));

    await expect(action(PREV, form(AT_DOOR))).resolves.toEqual({
      error: "Your bags are with the airline.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows a core refusal verbatim", async () => {
    handler.mockRejectedValue(
      new BookingNotActionableError(
        "startPickup",
        "terminal",
        "before_window_end",
        "This booking was cancelled.",
      ),
    );
    await expect(action(PREV, form(AT_DOOR))).resolves.toEqual({
      error: "This booking was cancelled.",
    });
  });

  it(`answers a crash with "${fallback} Check your connection and try again."`, async () => {
    handler.mockRejectedValue(new Error("boom"));

    await expect(action(PREV, form(AT_DOOR))).resolves.toEqual({
      error: `${fallback} Check your connection and try again.`,
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("answers a lost session with the context's own sentence", async () => {
    vi.mocked(resolveActionContext).mockRejectedValue(
      new ApiHttpError("not_authorized", "Please sign in again."),
    );
    await expect(action(PREV, form(AT_DOOR))).resolves.toEqual({
      error: "Please sign in again.",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* capturePassportAction — the upload happens here, the check there    */
/* ------------------------------------------------------------------ */

describe("capturePassportAction", () => {
  const good = () => form({ taskId: TASK_ID, passport: photo("image/webp") });

  it.each([
    ["no file", form({ taskId: TASK_ID }), "Take a photo of the passport page first."],
    [
      "an empty file",
      form({ taskId: TASK_ID, passport: photo("image/jpeg", 0) }),
      "Take a photo of the passport page first.",
    ],
    [
      "a file over 4 MB",
      form({ taskId: TASK_ID, passport: photo("image/jpeg", 4 * 1024 * 1024 + 1) }),
      "That photo is too large — keep it under 4 MB.",
    ],
    [
      "a non-image",
      form({ taskId: TASK_ID, passport: photo("application/pdf") }),
      "Photos must be JPEG, PNG, or WebP.",
    ],
  ])("refuses %s before touching the session", async (_label, data, message) => {
    await expect(capturePassportAction(PREV, data)).resolves.toEqual({ error: message });
    expect(resolveActionContext).not.toHaveBeenCalled();
    expect(uploadPassportPhoto).not.toHaveBeenCalled();
  });

  it("needs a task id", async () => {
    await expect(
      capturePassportAction(PREV, form({ passport: photo() })),
    ).resolves.toEqual({
      error: "Reload the task and try again.",
    });
  });

  it("uploads under the booking core resolved, then hands the key to the handler", async () => {
    vi.mocked(capturePassport).mockResolvedValue({ ok: true });

    await expect(capturePassportAction(PREV, good())).resolves.toEqual({ ok: true });

    // The assignment-scoped read, at the context's clock — and BEFORE the upload.
    expect(getVisitContext).toHaveBeenCalledWith(ctx.core.db, ctx.session, TASK_ID, NOW);
    expect(uploadPassportPhoto).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      data: expect.any(Uint8Array),
      contentType: "image/webp",
      extension: "webp",
    });
    expect(vi.mocked(getVisitContext).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(uploadPassportPhoto).mock.invocationCallOrder[0]!,
    );
    expect(capturePassport).toHaveBeenCalledWith(ctx, TASK_ID, {
      storagePath: `passports/${BOOKING_ID}/new.jpg`,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("does not upload for a task that is not this agent's", async () => {
    vi.mocked(getVisitContext).mockRejectedValue(
      new (await import("@koolee/core")).NotFoundError("Task", TASK_ID),
    );
    await expect(capturePassportAction(PREV, good())).resolves.toEqual({
      error: `Task ${TASK_ID} not found.`,
    });
    expect(uploadPassportPhoto).not.toHaveBeenCalled();
    expect(capturePassport).not.toHaveBeenCalled();
  });

  it("aborts on a failed upload without recording anything", async () => {
    vi.mocked(uploadPassportPhoto).mockResolvedValue(null);
    await expect(capturePassportAction(PREV, good())).resolves.toEqual({
      error: "Photo upload failed. Check your connection and try again.",
    });
    expect(capturePassport).not.toHaveBeenCalled();
  });

  it("shows the handler's storage guard verbatim", async () => {
    vi.mocked(capturePassport).mockRejectedValue(
      new ApiHttpError("invalid_input", "That photo wasn't found. Upload it again."),
    );
    await expect(capturePassportAction(PREV, good())).resolves.toEqual({
      error: "That photo wasn't found. Upload it again.",
    });
  });

  it("falls back for a crash", async () => {
    vi.mocked(capturePassport).mockRejectedValue(new Error("boom"));
    await expect(capturePassportAction(PREV, good())).resolves.toEqual({
      error: "Couldn't save the passport photo. Check your connection and try again.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* sealBagAction — contract copy for the fields, form copy for the photo */
/* ------------------------------------------------------------------ */

describe("sealBagAction", () => {
  const fields = { ...AT_DOOR, bagId: BAG_ID, sealId: "SEAL-42", weightKg: "17.5" };
  const good = () => form({ ...fields, photo: photo("image/png") });

  it.each([
    ["a blank seal id", { sealId: "   " }, "Enter the seal id."],
    ["a weight over 99", { weightKg: "100" }, "Weight must be under 99 kg."],
    ["a zero weight", { weightKg: "0" }, "Weight must be greater than 0."],
    ["a blank weight", { weightKg: "" }, "Enter the bag's weight in kg."],
  ])("refuses %s with the contract's own sentence", async (_label, patch, message) => {
    await expect(
      sealBagAction(PREV, form({ ...fields, ...patch, photo: photo() })),
    ).resolves.toEqual({ error: message });
    expect(resolveActionContext).not.toHaveBeenCalled();
    expect(sealBag).not.toHaveBeenCalled();
  });

  it("checks the fields before the photo, so a blank seal id is what the driver hears", async () => {
    await expect(sealBagAction(PREV, form({ ...fields, sealId: "" }))).resolves.toEqual({
      error: "Enter the seal id.",
    });
  });

  it.each([
    ["no photo", {}, "Take a photo of the bag before sealing it."],
    [
      "an empty photo",
      { photo: photo("image/jpeg", 0) },
      "Take a photo of the bag before sealing it.",
    ],
    [
      "a photo over 4 MB",
      { photo: photo("image/jpeg", 4 * 1024 * 1024 + 1) },
      "That photo is too large — keep it under 4 MB.",
    ],
    ["a non-image", { photo: photo("text/plain") }, "Photos must be JPEG, PNG, or WebP."],
  ])("refuses %s before uploading", async (_label, patch, message) => {
    await expect(sealBagAction(PREV, form({ ...fields, ...patch }))).resolves.toEqual({
      error: message,
    });
    expect(upload).not.toHaveBeenCalled();
    expect(sealBag).not.toHaveBeenCalled();
  });

  it("uploads to bags/<bagId>/ on the cookie client and hands the full contract body over", async () => {
    vi.mocked(sealBag).mockResolvedValue({ ok: true });

    await expect(sealBagAction(PREV, good())).resolves.toEqual({ ok: true });

    expect(ctx.supabase.storage.from).toHaveBeenCalledWith("bag-photos");
    const [path, bytes, options] = upload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^bags/${BAG_ID}/[0-9a-f-]{36}\\.png$`));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(options).toEqual({ contentType: "image/png", upsert: false });

    expect(sealBag).toHaveBeenCalledWith(ctx, TASK_ID, {
      bagId: BAG_ID,
      sealId: "SEAL-42",
      weightKg: 17.5,
      photoPath: path,
      ...GPS,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("trims the seal id, as the contract does for the app", async () => {
    vi.mocked(sealBag).mockResolvedValue({ ok: true });
    await sealBagAction(PREV, form({ ...fields, sealId: "  SEAL-42 ", photo: photo() }));
    expect(sealBag).toHaveBeenCalledWith(
      ctx,
      TASK_ID,
      expect.objectContaining({ sealId: "SEAL-42" }),
    );
  });

  it("aborts the seal when the upload fails — never a sealed bag without its photo", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(sealBagAction(PREV, good())).resolves.toEqual({
      error: "Photo upload failed. Check your connection and try again.",
    });
    expect(sealBag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("shows a seal-in-use conflict verbatim", async () => {
    vi.mocked(sealBag).mockRejectedValue(new ConflictError("seal"));
    await expect(sealBagAction(PREV, good())).resolves.toEqual({
      error: new ConflictError("seal").message,
    });
  });

  it("falls back for a crash", async () => {
    vi.mocked(sealBag).mockRejectedValue(new Error("boom"));
    await expect(sealBagAction(PREV, good())).resolves.toEqual({
      error: "Couldn't record the seal. Check your connection and try again.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* The exception reports                                               */
/* ------------------------------------------------------------------ */

describe("reportExceptionAction", () => {
  it("forwards the reason, the trimmed note and the position", async () => {
    vi.mocked(reportVisitException).mockResolvedValue({ ok: true });

    await expect(
      reportExceptionAction(
        PREV,
        form({ ...AT_DOOR, reason: "customer_not_home", note: "  nobody answered  " }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(reportVisitException).toHaveBeenCalledWith(ctx, TASK_ID, {
      reason: "customer_not_home",
      note: "nobody answered",
      ...GPS,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("leaves the note out when it is blank", async () => {
    vi.mocked(reportVisitException).mockResolvedValue({ ok: true });
    await reportExceptionAction(PREV, form({ ...AT_DOOR, reason: "other", note: "   " }));
    expect(reportVisitException).toHaveBeenCalledWith(ctx, TASK_ID, {
      reason: "other",
      ...GPS,
    });
  });

  it.each([
    ["an unknown reason", { reason: "dog_ate_it" }],
    ["no reason", {}],
  ])('answers "Pick a reason." for %s', async (_label, patch) => {
    await expect(
      reportExceptionAction(PREV, form({ ...AT_DOOR, ...patch })),
    ).resolves.toEqual({
      error: "Pick a reason.",
    });
    expect(reportVisitException).not.toHaveBeenCalled();
  });

  it("names the note, not the reason, when the note is past the contract's ceiling", async () => {
    await expect(
      reportExceptionAction(
        PREV,
        form({ ...AT_DOOR, reason: "other", note: "x".repeat(501) }),
      ),
    ).resolves.toEqual({ error: "Keep the note under 500 characters." });
    expect(reportVisitException).not.toHaveBeenCalled();
  });

  it("shows a refusal verbatim and falls back for a crash", async () => {
    vi.mocked(reportVisitException).mockRejectedValueOnce(refused("Already reported."));
    await expect(
      reportExceptionAction(PREV, form({ ...AT_DOOR, reason: "other" })),
    ).resolves.toEqual({ error: "Already reported." });

    vi.mocked(reportVisitException).mockRejectedValueOnce(new Error("boom"));
    await expect(
      reportExceptionAction(PREV, form({ ...AT_DOOR, reason: "other" })),
    ).resolves.toEqual({
      error: "Couldn't report the problem. Check your connection and try again.",
    });
  });
});

describe("reportPickupExceptionAction", () => {
  it("forwards the contract body to the pickup handler", async () => {
    vi.mocked(reportPickupException).mockResolvedValue({ ok: true });

    await expect(
      reportPickupExceptionAction(
        PREV,
        form({ ...AT_DOOR, reason: "seal_mismatch", note: "tag reads 41" }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(reportPickupException).toHaveBeenCalledWith(ctx, TASK_ID, {
      reason: "seal_mismatch",
      note: "tag reads 41",
      ...GPS,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it('answers "Pick a reason." for a visit-only reason', async () => {
    await expect(
      reportPickupExceptionAction(PREV, form({ ...AT_DOOR, reason: "bags_refused" })),
    ).resolves.toEqual({ error: "Pick a reason." });
    expect(reportPickupException).not.toHaveBeenCalled();
  });

  it("names the note when it is past the contract's ceiling", async () => {
    await expect(
      reportPickupExceptionAction(
        PREV,
        form({ ...AT_DOOR, reason: "other", note: "x".repeat(501) }),
      ),
    ).resolves.toEqual({ error: "Keep the note under 500 characters." });
    expect(reportPickupException).not.toHaveBeenCalled();
  });

  it("falls back for a crash", async () => {
    vi.mocked(reportPickupException).mockRejectedValue(new Error("boom"));
    await expect(
      reportPickupExceptionAction(PREV, form({ ...AT_DOOR, reason: "other" })),
    ).resolves.toEqual({
      error: "Couldn't file that. Check your connection and try again.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* scanSealAction                                                      */
/* ------------------------------------------------------------------ */

describe("scanSealAction", () => {
  it("forwards the trimmed seal value and the position", async () => {
    vi.mocked(scanSeal).mockResolvedValue({
      ok: true,
      bagId: BAG_ID,
      scannedCount: 1,
      totalBags: 2,
      custodyTransferred: false,
    });

    await expect(
      scanSealAction(PREV, form({ ...AT_DOOR, sealValue: " SEAL-42 " })),
    ).resolves.toEqual({ ok: true });

    expect(scanSeal).toHaveBeenCalledWith(ctx, TASK_ID, { sealValue: "SEAL-42", ...GPS });
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it.each([["   "], [""]])(
    'answers "Scan or type the seal id." for %j',
    async (sealValue) => {
      await expect(
        scanSealAction(PREV, form({ ...AT_DOOR, sealValue })),
      ).resolves.toEqual({
        error: "Scan or type the seal id.",
      });
      expect(scanSeal).not.toHaveBeenCalled();
    },
  );

  it("shows a seal mismatch verbatim — the driver must not load the bag", async () => {
    const mismatch = new ConflictError(
      "seal",
      "That seal doesn't match. Don't load this bag.",
    );
    vi.mocked(scanSeal).mockRejectedValue(mismatch);
    await expect(
      scanSealAction(PREV, form({ ...AT_DOOR, sealValue: "SEAL-1" })),
    ).resolves.toEqual({ error: mismatch.message });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back for a crash", async () => {
    vi.mocked(scanSeal).mockRejectedValue(new Error("boom"));
    await expect(
      scanSealAction(PREV, form({ ...AT_DOOR, sealValue: "SEAL-1" })),
    ).resolves.toEqual({
      error: "Couldn't check that seal. Check your connection and try again.",
    });
  });
});
