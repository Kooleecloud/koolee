import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const tokens = vi.hoisted(() => ({
  result: vi.fn(async (): Promise<unknown> => ({ token: "tok" })),
}));
vi.mock("./supabase", () => ({ accessTokenResult: () => tokens.result() }));
vi.mock("./env", () => ({ env: { apiUrl: "http://api.test" } }));

import { apiFetch, ApiRequestError, isRetryable, NetworkError } from "./api";

const schema = z.object({ ok: z.literal(true), n: z.number() });

function respond(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the bearer token, the idempotency key and a JSON body, and parses the answer", async () => {
    fetchMock.mockResolvedValue(respond(201, { ok: true, n: 1, extra: "stripped" }));
    const out = await apiFetch(schema, "/api/v1/shift/start", {
      method: "POST",
      body: { truckId: "t" },
      idempotencyKey: "k-1",
    });
    expect(out).toEqual({ ok: true, n: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/shift/start");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ truckId: "t" }));
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["Idempotency-Key"]).toBe("k-1");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("turns a server refusal into an ApiRequestError carrying the message verbatim", async () => {
    fetchMock.mockResolvedValue(
      respond(409, {
        error: "conflict",
        message: "That truck is already out with Nina.",
        field: "shift",
      }),
    );
    const err = await apiFetch(schema, "/api/v1/shift/start", { body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(409);
    expect((err as ApiRequestError).code).toBe("conflict");
    expect((err as ApiRequestError).message).toBe("That truck is already out with Nina.");
    expect(isRetryable(err)).toBe(false);
  });

  it("treats no response as a NetworkError the queue will retry, and a 5xx likewise", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const err = await apiFetch(schema, "/api/v1/positions", { body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect(isRetryable(err)).toBe(true);

    fetchMock.mockResolvedValue(respond(503, { error: "unavailable", message: "Down." }));
    const down = await apiFetch(schema, "/api/v1/positions", { body: {} }).catch(
      (e: unknown) => e,
    );
    expect(isRetryable(down)).toBe(true);
  });

  it("treats an unrefreshable token with no signal as offline, not signed out", async () => {
    tokens.result.mockResolvedValueOnce({ token: null, reason: "offline" });
    const err = await apiFetch(schema, "/api/v1/positions", { body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NetworkError);
    expect(isRetryable(err)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a local 401 only when the driver is genuinely signed out", async () => {
    tokens.result.mockResolvedValueOnce({ token: null, reason: "signed_out" });
    const err = await apiFetch(schema, "/api/v1/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a 2xx whose body does not match the contract", async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, n: "not a number" }));
    await expect(apiFetch(schema, "/api/v1/me")).rejects.toBeInstanceOf(ApiRequestError);
  });
});
