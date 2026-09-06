import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

const { WebPushSender, createWebPushSender } = await import("./web-push");

/**
 * The sender, with `web-push` faked.
 *
 * Three things are worth pinning and none of them are observable in
 * production until they are wrong:
 *  - what actually goes on the wire (the subscription shape the library
 *    wants is NOT the shape the row is stored in);
 *  - that 410 prunes and a 500 does NOT — pruning on a transient failure
 *    would unsubscribe people for a provider's bad afternoon;
 *  - that nothing ever throws into the caller, which is an Inngest step whose
 *    email is the real notification.
 */

const target = (id: string) => ({
  id,
  endpoint: `https://push.example/${id}`,
  p256dh: `p256dh-${id}`,
  auth: `auth-${id}`,
});

const payload = { title: "Bags sealed", body: "KOO-7H2QM", tag: "booking:b-1" };

const sender = () =>
  new WebPushSender({
    publicKey: "pub",
    privateKey: "priv",
    subject: "mailto:ops@koolee.cloud",
  });

/** A rejection shaped like `web-push`'s `WebPushError`. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push service said ${statusCode}`), { statusCode });
}

describe("WebPushSender", () => {
  beforeEach(() => {
    sendNotification.mockReset();
    setVapidDetails.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it("sends the library's subscription shape, with a TTL and the urgency", async () => {
    await sender().send([target("s1")], payload, { urgency: "high" });

    expect(setVapidDetails).toHaveBeenCalledWith(
      "mailto:ops@koolee.cloud",
      "pub",
      "priv",
    );
    expect(sendNotification).toHaveBeenCalledTimes(1);

    const [subscription, body, options] = sendNotification.mock.calls[0]!;
    // Stored flat, sent nested — the conversion is the thing that breaks.
    expect(subscription).toEqual({
      endpoint: "https://push.example/s1",
      keys: { p256dh: "p256dh-s1", auth: "auth-s1" },
    });
    expect(JSON.parse(body as string)).toEqual(payload);
    expect(options).toEqual({ TTL: 300, urgency: "high" });
  });

  it("defaults to normal urgency", async () => {
    await sender().send([target("s1")], payload);
    expect(sendNotification.mock.calls[0]![2]).toMatchObject({ urgency: "normal" });
  });

  it("prunes on 410 and on 404 — the subscription is gone for good", async () => {
    sendNotification
      .mockRejectedValueOnce(pushError(410))
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(pushError(404));

    const result = await sender().send(
      [target("dead"), target("alive"), target("gone")],
      payload,
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.expired.sort()).toEqual(["dead", "gone"]);
  });

  it("does NOT prune on a transient failure", async () => {
    sendNotification.mockRejectedValue(pushError(500));

    const result = await sender().send([target("s1")], payload);

    expect(result.failed).toBe(1);
    // A 5xx is the provider having a bad afternoon. Unsubscribing somebody
    // over it means they never hear from us again and nothing says why.
    expect(result.expired).toEqual([]);
  });

  it("never throws, even when the library rejects with something unrecognisable", async () => {
    sendNotification.mockRejectedValue("not an error object");

    await expect(sender().send([target("s1")], payload)).resolves.toEqual({
      sent: 0,
      failed: 1,
      expired: [],
    });
  });

  it("does nothing at all with no targets — no VAPID call, no request", async () => {
    const result = await sender().send([], payload);
    expect(result).toEqual({ sent: 0, failed: 0, expired: [] });
    expect(setVapidDetails).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("createWebPushSender — the kill switch comes first", () => {
  const keys = { publicKey: "a", privateKey: "b", subject: "mailto:x@y.z" };

  it("returns a real sender only when push is ENABLED and fully configured", () => {
    const sender = createWebPushSender({ enabled: true, ...keys });
    expect(sender).not.toBeNull();
    expect(sender!.delivers).toBe(true);
  });

  it("returns null when the switch is OFF, even with every key present", () => {
    // The order matters: turning push off must not depend on somebody also
    // remembering to remove the credentials.
    expect(createWebPushSender({ enabled: false, ...keys })).toBeNull();
  });

  it("returns null on a partial configuration rather than a sender that fails every send", () => {
    // Signing needs the pair, and Apple refuses a push whose `sub` is not a
    // valid mailto:/https: URL. Half-configured must fall back to the console
    // sender, not fail at runtime on every notification.
    expect(
      createWebPushSender({ enabled: true, publicKey: "a", privateKey: "b" }),
    ).toBeNull();
    expect(
      createWebPushSender({ enabled: true, publicKey: "a", subject: "mailto:x@y.z" }),
    ).toBeNull();
    expect(
      createWebPushSender({ enabled: true, privateKey: "b", subject: "mailto:x@y.z" }),
    ).toBeNull();
    expect(createWebPushSender({ enabled: true })).toBeNull();
  });

  it("a null return means the CONSOLE sender — which does not deliver", async () => {
    // The consequence worth stating: falling back is not neutral. Every send
    // then logs and reports success, which is right when push is deliberately
    // off and a silent outage when it is not.
    const { ConsolePushSender } = await import("./push");
    expect(new ConsolePushSender().delivers).toBe(false);
  });
});
