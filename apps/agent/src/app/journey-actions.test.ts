import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";

import { resolveActionContext, type ApiContext } from "@/api/context";
import { ApiHttpError, refused } from "@/api/errors";
import { startPickup } from "@/api/handlers/pickup";

import { startPickupFromJourney } from "./journey-actions";

/**
 * Navigate's "set off" signal goes through the same `startPickup` handler as
 * the app's `POST /api/v1/tasks/:id/pickup/start`, with no position — and it
 * NEVER throws, because a maps app is opening over the top of it.
 */

vi.mock("@/api/context", () => ({ resolveActionContext: vi.fn() }));
vi.mock("@/api/handlers/pickup", () => ({ startPickup: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TASK_ID = "00000000-0000-4000-8000-000000000002";
const ctx = { core: {}, session: { userId: "user-1" } } as unknown as ApiContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveActionContext).mockResolvedValue(ctx);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("startPickupFromJourney", () => {
  it("starts the leg through the pickup handler with no fix, then refreshes both surfaces", async () => {
    vi.mocked(startPickup).mockResolvedValue({ ok: true });

    await expect(startPickupFromJourney(TASK_ID)).resolves.toEqual({ ok: true });

    expect(startPickup).toHaveBeenCalledWith(ctx, TASK_ID, {});
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("refuses an empty task id without a session lookup", async () => {
    await expect(startPickupFromJourney("")).resolves.toEqual({
      ok: false,
      error: "Missing task.",
    });
    expect(resolveActionContext).not.toHaveBeenCalled();
  });

  it("keeps a refusal's own sentence for the toast", async () => {
    vi.mocked(startPickup).mockRejectedValue(refused("This booking was cancelled."));
    await expect(startPickupFromJourney(TASK_ID)).resolves.toEqual({
      ok: false,
      error: "This booking was cancelled.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the handler crashes",
      () => vi.mocked(startPickup).mockRejectedValue(new Error("boom")),
    ],
    [
      "the session is gone",
      () =>
        vi
          .mocked(resolveActionContext)
          .mockRejectedValue(new ApiHttpError("unavailable", "The server isn't ready.")),
    ],
  ])("never throws when %s", async (_label, arrange) => {
    arrange();
    const result = await startPickupFromJourney(TASK_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("answers a crash with the connection fallback", async () => {
    vi.mocked(startPickup).mockRejectedValue(new Error("boom"));
    await expect(startPickupFromJourney(TASK_ID)).resolves.toEqual({
      ok: false,
      error: "Couldn't start the pickup. Check your connection and try again.",
    });
  });
});
