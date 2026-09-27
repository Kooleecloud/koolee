import type { z } from "zod";
import {
  API_ERROR_STATUS,
  apiErrorSchema,
  IDEMPOTENCY_HEADER,
  type ApiError,
  type ApiErrorCode,
} from "@koolee/api-contract";

import { env } from "./env";
import { accessToken } from "./supabase";

/**
 * The one way this app talks to `/api/v1`.
 *
 * Every response is parsed with the contract schema the caller names, so a
 * server change that breaks the shape fails loudly at the call site instead of
 * as an `undefined` somewhere in a screen. Every non-2xx is an
 * `ApiRequestError` carrying the server's `{ error, message }`; the message is
 * safe to show the driver verbatim (that is the contract's rule).
 *
 * TRANSPORT FAILURES are a different class: no response at all. They surface
 * as `NetworkError`, which the offline queue treats as "keep and retry" while
 * a 4xx is "drop, it will never succeed".
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }

  get code(): ApiErrorCode | null {
    return this.body?.error ?? null;
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Check your connection and try again.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  /** Device-minted key for a mutating request the offline queue may replay. */
  idempotencyKey?: string;
  /** Override for headless callers that already hold a token. */
  token?: string | null;
  signal?: AbortSignal;
}

export const TRANSPORT_FALLBACK =
  "Something went wrong. Check your connection and try again.";

export async function apiFetch<T>(
  schema: z.ZodType<T>,
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const token = init.token === undefined ? await accessToken() : init.token;
  if (!token)
    throw new ApiRequestError(
      401,
      { error: "not_authorized", message: "Please sign in again." },
      "Please sign in again.",
    );

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers[IDEMPOTENCY_HEADER] = init.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  const text = await response.text();
  const json: unknown = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data : null,
      TRANSPORT_FALLBACK,
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      "[api] response failed the contract",
      path,
      parsed.error.issues.slice(0, 3),
    );
    throw new ApiRequestError(response.status, null, TRANSPORT_FALLBACK);
  }
  return parsed.data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Whether a failed request should be retried later (transport / server) or dropped (client). */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiRequestError) return error.status >= 500;
  return false;
}

export function statusFor(code: ApiErrorCode): number {
  return API_ERROR_STATUS[code];
}
