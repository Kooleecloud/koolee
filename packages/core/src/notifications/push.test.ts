import { describe, expect, it } from "vitest";

import { createCoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { ConsolePushSender, RecordingPushSender } from "./push";

/**
 * The fallback must never be mistaken for a delivery.
 *
 * This is a regression test for a bug that shipped and was found by a human,
 * not by the suite: the agent and admin apps had no real `PushSender`, so
 * `createCoreConfig` gave them `ConsolePushSender` — which logs one line and
 * returns `{ sent: targets.length, failed: 0 }`. Their `/api/push/test`
 * route read those counts, reported `accepted: true`, and the card asked
 * "Did a notification just appear?" about a notification that had never left
 * the process.
 *
 * The counts are the trap: a console fallback and a flawless send are
 * IDENTICAL in them. So anything reporting delivery to a human has to consult
 * `delivers` instead, and these assertions are what stop that flag being
 * quietly dropped or defaulted to `true` for convenience.
 */

const target = { id: "s1", endpoint: "https://push.example/s1", p256dh: "p", auth: "a" };
const payload = { title: "t", body: "b", tag: "tag" };

describe("PushSender.delivers", () => {
  it("the console fallback says it does NOT deliver", () => {
    expect(new ConsolePushSender().delivers).toBe(false);
  });

  it("...while still reporting a successful send — which is the whole trap", async () => {
    const result = await new ConsolePushSender().send([target], payload);
    // Indistinguishable from a real send. This assertion is deliberately
    // pinning the misleading behaviour, so nobody "fixes" the counts and
    // assumes the problem is gone: the counts are not where the truth is.
    expect(result).toEqual({ sent: 1, failed: 0, expired: [] });
  });

  it("a config with no injected sender falls back to a non-delivering one", () => {
    const config = createCoreConfig({
      db: null as never,
      payments: new FakePaymentProvider(),
    });
    // Exactly the state the agent and admin apps were in. Every app that
    // sends must inject a real sender; `delivers` is how a caller can tell.
    expect(config.pushSender.delivers).toBe(false);
  });

  it("an injected sender is trusted to deliver", () => {
    const config = createCoreConfig({
      db: null as never,
      payments: new FakePaymentProvider(),
      pushSender: new RecordingPushSender(),
    });
    expect(config.pushSender.delivers).toBe(true);
  });
});
