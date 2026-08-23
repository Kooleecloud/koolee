import { describe, expect, it, vi } from "vitest";

import { createNotifier } from "../factory";
import { ConsoleNotifier } from "../notifier";
import { ResendNotifier, ResendSendError } from "./notifier";

/**
 * Phase 4 acceptance — the Resend adapter against a faked client. No live
 * calls anywhere: `fetchImpl` is injected.
 */

function fakeFetch(response: { ok: boolean; status?: number; body?: string }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(response.body ?? "{}", {
      status: response.ok ? 200 : (response.status ?? 500),
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("ResendNotifier", () => {
  it("POSTs the exact Resend payload shape", async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    const notifier = new ResendNotifier({
      apiKey: "re_test_123",
      from: "Koolee <notify@koolee.test>",
      fetchImpl: impl,
    });

    await notifier.sendEmail({
      to: "traveler@example.com",
      subject: "Your pickup is confirmed",
      body: "Plain text body",
      html: "<p>Plain text body</p>",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer re_test_123");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Koolee <notify@koolee.test>",
      to: ["traveler@example.com"],
      subject: "Your pickup is confirmed",
      text: "Plain text body",
      html: "<p>Plain text body</p>",
    });
  });

  it("omits html from the payload when the message has none", async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    const notifier = new ResendNotifier({
      apiKey: "re_test_123",
      from: "Koolee <notify@koolee.test>",
      fetchImpl: impl,
    });

    await notifier.sendEmail({ to: "a@b.test", subject: "s", body: "text only" });

    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("html");
  });

  it("throws ResendSendError with the status on a non-2xx response", async () => {
    const { impl } = fakeFetch({ ok: false, status: 422, body: '{"message":"bad from"}' });
    const notifier = new ResendNotifier({
      apiKey: "re_test_123",
      from: "not-an-address",
      fetchImpl: impl,
    });

    const attempt = notifier.sendEmail({ to: "a@b.test", subject: "s", body: "b" });
    await expect(attempt).rejects.toBeInstanceOf(ResendSendError);
    await expect(
      notifier.sendEmail({ to: "a@b.test", subject: "s", body: "b" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("propagates network failures — swallowing is the caller's decision", async () => {
    const impl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const notifier = new ResendNotifier({
      apiKey: "re_test_123",
      from: "Koolee <notify@koolee.test>",
      fetchImpl: impl as unknown as typeof fetch,
    });

    await expect(
      notifier.sendEmail({ to: "a@b.test", subject: "s", body: "b" }),
    ).rejects.toThrow("ECONNRESET");
  });

  it("keeps SMS on the console fallback — never touches the Resend API", async () => {
    const { impl } = fakeFetch({ ok: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const notifier = new ResendNotifier({
      apiKey: "re_test_123",
      from: "Koolee <notify@koolee.test>",
      fetchImpl: impl,
    });

    await notifier.sendSms({ to: "+15551234567", body: "on our way" });

    expect(impl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("createNotifier", () => {
  it("selects Resend when a key is injected, console otherwise", () => {
    expect(
      createNotifier({ kind: "resend", apiKey: "re_x", from: "K <n@k.test>" }),
    ).toBeInstanceOf(ResendNotifier);
    expect(createNotifier({ kind: "console" })).toBeInstanceOf(ConsoleNotifier);
  });
});
