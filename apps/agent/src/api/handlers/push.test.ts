import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import {
  pushRegisterResponseSchema,
  pushTestResponseSchema,
  pushUnregisterResponseSchema,
} from "@koolee/api-contract";

const mocks = vi.hoisted(() => ({
  registerDriverPushToken: vi.fn(),
  unregisterDriverPushToken: vi.fn(),
  listDriverPushTokens: vi.fn(),
  disableDriverPushTokens: vi.fn(),
}));

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  registerDriverPushToken: (...a: unknown[]) => mocks.registerDriverPushToken(...a),
  unregisterDriverPushToken: (...a: unknown[]) => mocks.unregisterDriverPushToken(...a),
  listDriverPushTokens: (...a: unknown[]) => mocks.listDriverPushTokens(...a),
  disableDriverPushTokens: (...a: unknown[]) => mocks.disableDriverPushTokens(...a),
}));

import type { ApiContext } from "../context";
import { ApiHttpError } from "../errors";
import { registerPushToken, sendTestPush, unregisterPushToken } from "./push";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: { tag: "db" }, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
} as unknown as ApiContext;

const TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const ROW_ID = "9f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b";

describe("push handlers", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
  });

  it("registers the token for the SESSION's user, never one off the body", async () => {
    mocks.registerDriverPushToken.mockResolvedValue({ id: ROW_ID });

    const body = await registerPushToken(ctx, {
      token: TOKEN,
      platform: "ios",
      deviceLabel: "iPhone",
    });

    expect(mocks.registerDriverPushToken).toHaveBeenCalledWith(ctx.core, {
      userId: "user-1",
      token: TOKEN,
      platform: "ios",
      deviceLabel: "iPhone",
    });
    expect(pushRegisterResponseSchema.parse(body)).toEqual({ ok: true, id: ROW_ID });
  });

  it("passes an absent label through as undefined", async () => {
    mocks.registerDriverPushToken.mockResolvedValue({ id: ROW_ID });
    await registerPushToken(ctx, { token: TOKEN, platform: "android" });
    expect(mocks.registerDriverPushToken).toHaveBeenCalledWith(
      ctx.core,
      expect.objectContaining({ platform: "android", deviceLabel: undefined }),
    );
  });

  it("lets a core refusal propagate untouched", async () => {
    const error = new Error("That is not an Expo push token.");
    mocks.registerDriverPushToken.mockRejectedValue(error);
    await expect(registerPushToken(ctx, { token: TOKEN, platform: "ios" })).rejects.toBe(
      error,
    );
  });

  it("unregisters scoped by the session's user and answers whether anything matched", async () => {
    mocks.unregisterDriverPushToken
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    expect(
      pushUnregisterResponseSchema.parse(
        await unregisterPushToken(ctx, { token: TOKEN }),
      ),
    ).toEqual({ ok: true });
    expect(await unregisterPushToken(ctx, { token: TOKEN })).toEqual({ ok: false });
    expect(mocks.unregisterDriverPushToken).toHaveBeenCalledWith(ctx.core, {
      userId: "user-1",
      token: TOKEN,
    });
  });
});

describe("sendTestPush", () => {
  const OTHER = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]";

  function ctxWith(sender: { delivers: boolean; send: ReturnType<typeof vi.fn> }) {
    return {
      ...ctx,
      core: { db: { tag: "db" }, clock: { now: () => NOW }, expoPushSender: sender },
    } as unknown as ApiContext;
  }

  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.disableDriverPushTokens.mockResolvedValue(0);
  });

  it("refuses with not_configured when the sender only logs — nothing was sent", async () => {
    const send = vi.fn();
    const error = await sendTestPush(ctxWith({ delivers: false, send })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(503);
    expect((error as ApiHttpError).body.error).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
    expect(mocks.listDriverPushTokens).not.toHaveBeenCalled();
  });

  it("refuses with no_subscription when the caller has no active device", async () => {
    mocks.listDriverPushTokens.mockResolvedValue([]);
    const send = vi.fn();
    const error = await sendTestPush(ctxWith({ delivers: true, send })).catch(
      (e: unknown) => e,
    );
    expect((error as ApiHttpError).status).toBe(409);
    expect((error as ApiHttpError).body.error).toBe("no_subscription");
    expect(mocks.listDriverPushTokens).toHaveBeenCalledWith({ tag: "db" }, ["user-1"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to the SESSION user's devices only, uniquely tagged, and disables the dead", async () => {
    mocks.listDriverPushTokens.mockResolvedValue([
      { id: "a", userId: "user-1", token: TOKEN, platform: "ios" },
      { id: "b", userId: "user-1", token: OTHER, platform: "android" },
    ]);
    const send = vi.fn().mockResolvedValue({ sent: 1, failed: 1, invalid: [OTHER] });

    const body = await sendTestPush(ctxWith({ delivers: true, send }));

    expect(pushTestResponseSchema.parse(body)).toEqual({ accepted: true });
    expect(send).toHaveBeenCalledWith(
      [TOKEN, OTHER],
      expect.objectContaining({ tag: `push-test:${NOW.getTime()}` }),
      { urgency: "high" },
    );
    expect(mocks.disableDriverPushTokens).toHaveBeenCalledWith(
      { tag: "db" },
      [OTHER],
      NOW,
    );
  });

  it.each([
    [["InvalidCredentials"], "setup"],
    [["DeviceNotRegistered", "DeveloperError"], "setup"],
    [["DeviceNotRegistered"], "device"],
    [["MessageRateExceeded"], "relay"],
    [["RequestFailed"], "relay"],
    [[], "relay"],
  ])("answers accepted: false with %j sorted as %s", async (errorCodes, failure) => {
    mocks.listDriverPushTokens.mockResolvedValue([
      { id: "a", userId: "user-1", token: TOKEN, platform: "ios" },
    ]);
    const send = vi
      .fn()
      .mockResolvedValue({ sent: 0, failed: 1, invalid: [], errorCodes });
    const body = await sendTestPush(ctxWith({ delivers: true, send }));
    expect(pushTestResponseSchema.parse(body)).toEqual({ accepted: false, failure });
  });
});
