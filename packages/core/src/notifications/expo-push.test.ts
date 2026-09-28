import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPushNotificationsAsync = vi.fn();
const getPushNotificationReceiptsAsync = vi.fn();
const constructed: unknown[] = [];

vi.mock("expo-server-sdk", () => {
  class Expo {
    constructor(options: unknown) {
      constructed.push(options);
    }
    sendPushNotificationsAsync(...args: unknown[]) {
      return sendPushNotificationsAsync(...args);
    }
    getPushNotificationReceiptsAsync(...args: unknown[]) {
      return getPushNotificationReceiptsAsync(...args);
    }
    // Two per chunk, so a three-token send exercises the loop.
    chunkPushNotifications<T>(messages: T[]): T[][] {
      const chunks: T[][] = [];
      for (let i = 0; i < messages.length; i += 2) chunks.push(messages.slice(i, i + 2));
      return chunks;
    }
    chunkPushNotificationReceiptIds(ids: string[]): string[][] {
      return ids.length === 0 ? [] : [ids];
    }
  }
  return { Expo, default: Expo };
});

const { ExpoRelayPushSender, createExpoPushSender } = await import("./expo-push");

/**
 * The sender, with `expo-server-sdk` faked.
 *
 * What is worth pinning, none of it observable in production until wrong:
 *  - what goes on the wire (the message shape Expo wants, and that `data`
 *    carries the deep link and the collapse tag the way the SW does);
 *  - that `DeviceNotRegistered` — from a TICKET or a RECEIPT — marks the token
 *    invalid, and that a failed chunk or a 5xx does NOT;
 *  - that nothing ever throws into the caller.
 */

const T1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const T2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const T3 = "ExponentPushToken[cccccccccccccccccccccc]";

const payload = {
  title: "New pickup on your shift",
  body: "KOO-7H2QM · 2 bags.",
  tag: "pickup-task:t-1",
  url: "https://agent.koolee.cloud/tasks/t-1",
  data: { bookingRef: "KOO-7H2QM" },
};

const ok = (id: string) => ({ status: "ok", id });
const notRegistered = (token: string) => ({
  status: "error",
  message: `"${token}" is not a registered push notification recipient`,
  details: { error: "DeviceNotRegistered", expoPushToken: token },
});

describe("ExpoRelayPushSender", () => {
  beforeEach(() => {
    sendPushNotificationsAsync.mockReset();
    getPushNotificationReceiptsAsync.mockReset().mockResolvedValue({});
    constructed.length = 0;
  });

  it("sends Expo's message shape: data carries the url and tag, high urgency is high priority", async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok("r1")]);

    const result = await new ExpoRelayPushSender().send([T1], payload, {
      urgency: "high",
    });

    expect(result).toEqual({ sent: 1, failed: 0, invalid: [], errorCodes: [] });
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationsAsync.mock.calls[0]![0]).toEqual([
      {
        to: T1,
        title: payload.title,
        body: payload.body,
        data: { url: payload.url, tag: payload.tag, bookingRef: "KOO-7H2QM" },
        priority: "high",
        channelId: "default",
        sound: "default",
        ttl: 300,
      },
    ]);
  });

  it("defaults to default priority and omits an absent url from data", async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok("r1")]);

    await new ExpoRelayPushSender().send([T1], { title: "t", body: "b", tag: "x" });

    const [message] = sendPushNotificationsAsync.mock.calls[0]![0] as {
      data: unknown;
      priority: unknown;
    }[];
    expect(message!.priority).toBe("default");
    expect(message!.data).toEqual({ tag: "x" });
  });

  it("chunks, and a DeviceNotRegistered TICKET marks that token invalid", async () => {
    sendPushNotificationsAsync
      .mockResolvedValueOnce([ok("r1"), notRegistered(T2)])
      .mockResolvedValueOnce([ok("r3")]);

    const result = await new ExpoRelayPushSender().send([T1, T2, T3], payload);

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      sent: 2,
      failed: 1,
      invalid: [T2],
      errorCodes: ["DeviceNotRegistered"],
    });
  });

  it("asks for receipts once, and a DeviceNotRegistered RECEIPT also marks the token", async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok("r1"), ok("r2")]);
    // r1 arrived; r2 was ticketed by Expo and then refused by APNs.
    getPushNotificationReceiptsAsync.mockResolvedValue({
      r1: { status: "ok" },
      r2: {
        status: "error",
        message: "gone",
        details: { error: "DeviceNotRegistered" },
      },
    });

    const result = await new ExpoRelayPushSender().send([T1, T2], payload);

    expect(getPushNotificationReceiptsAsync).toHaveBeenCalledWith(["r1", "r2"]);
    // A receipt that says refused moves the ticket from sent to failed.
    expect(result).toEqual({
      sent: 1,
      failed: 1,
      invalid: [T2],
      errorCodes: ["DeviceNotRegistered"],
    });
  });

  it("treats a receipt not in yet as sent — Expo has not processed it, that is all", async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok("r1")]);
    getPushNotificationReceiptsAsync.mockResolvedValue({});

    const result = await new ExpoRelayPushSender().send([T1], payload);

    expect(result).toEqual({ sent: 1, failed: 0, invalid: [], errorCodes: [] });
  });

  it("does NOT mark a token on a transient failure — a whole chunk rejecting, a receipts outage, another error code", async () => {
    sendPushNotificationsAsync
      .mockRejectedValueOnce(new Error("exp.host 503"))
      .mockResolvedValueOnce([
        {
          status: "error",
          message: "slow down",
          details: { error: "MessageRateExceeded" },
        },
      ]);
    getPushNotificationReceiptsAsync.mockRejectedValue(new Error("receipts 502"));

    const result = await new ExpoRelayPushSender().send([T1, T2, T3], payload);

    // Chunk one (T1, T2) failed outright; chunk two (T3) was rate limited.
    // Disabling any of them over a bad afternoon would silence a driver for
    // good, with nothing saying why.
    expect(result).toEqual({
      sent: 0,
      failed: 3,
      invalid: [],
      // What the test push sorts on: neither says "credentials", so a
      // driver is told to try again rather than to fix their phone.
      errorCodes: ["RequestFailed", "MessageRateExceeded"],
    });
  });

  it("never throws, even when the SDK answers with something unrecognisable", async () => {
    sendPushNotificationsAsync.mockResolvedValue("not an array");

    await expect(new ExpoRelayPushSender().send([T1], payload)).resolves.toEqual({
      sent: 0,
      failed: 1,
      invalid: [],
      errorCodes: ["Unknown"],
    });
  });

  it("does nothing at all with no tokens — no request, no receipts", async () => {
    const result = await new ExpoRelayPushSender().send([], payload);
    expect(result).toEqual({ sent: 0, failed: 0, invalid: [], errorCodes: [] });
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(getPushNotificationReceiptsAsync).not.toHaveBeenCalled();
  });

  it("reports a credentials refusal once, whatever the number of devices, and disables nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refused = {
      status: "error" as const,
      message: "Could not find APNs credentials",
      details: { error: "InvalidCredentials" },
    };
    sendPushNotificationsAsync.mockResolvedValue([refused, refused]);

    const result = await new ExpoRelayPushSender().send([T1, T2], payload);

    expect(result).toEqual({
      sent: 0,
      failed: 2,
      invalid: [],
      errorCodes: ["InvalidCredentials"],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("InvalidCredentials");
    warn.mockRestore();
  });

  it("hands the access token to the SDK, and nothing when there is none", () => {
    new ExpoRelayPushSender({ accessToken: "eas-token" });
    new ExpoRelayPushSender();
    expect(constructed).toEqual([{ accessToken: "eas-token" }, {}]);
  });
});

describe("createExpoPushSender — the kill switch is the whole decision", () => {
  it("returns a real sender when push is ENABLED, with or without an access token", () => {
    expect(createExpoPushSender({ enabled: true })?.delivers).toBe(true);
    expect(createExpoPushSender({ enabled: true, accessToken: "x" })?.delivers).toBe(
      true,
    );
  });

  it("returns null when the switch is OFF, even with a token present", () => {
    // Same order as web push: turning push off must not depend on somebody
    // also remembering to remove the credential.
    expect(createExpoPushSender({ enabled: false, accessToken: "x" })).toBeNull();
  });

  it("a null return means the CONSOLE sender — which does not deliver", async () => {
    const { ConsoleExpoPushSender } = await import("./push");
    expect(new ConsoleExpoPushSender().delivers).toBe(false);
  });
});
