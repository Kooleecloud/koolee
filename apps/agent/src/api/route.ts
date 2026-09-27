import "server-only";

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
} from "@koolee/core";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  type ApiError,
} from "@koolee/api-contract";

import { resolveApiContext, type ApiContext } from "./context";
import { ApiHttpError, toApiHttpError } from "./errors";

/**
 * The wrapper every `/api/v1` route handler is written against.
 *
 * It does the four things that would otherwise be copied into twenty files:
 *
 *  1. AUTH — bearer token or cookie, role re-checked per request (`context`).
 *  2. BODY — parsed once, validated with the contract schema; a bad body is a
 *     400 `invalid_body` carrying the first issue's message so the app can
 *     show it.
 *  3. IDEMPOTENCY — for `mutating` routes, an `Idempotency-Key` header claims
 *     a row before the handler runs (see core `api-idempotency`). A replay
 *     gets the stored answer; a mismatch is refused; a 5xx releases the row.
 *     No header, no protection — the web app's own callers never send one.
 *  4. ERRORS — one mapping from thrown things to `{ error, message }` bodies
 *     and status codes (`errors.ts`).
 *
 * A route file stays three lines: the schema, the handler, and
 * `export const dynamic = "force-dynamic"` (Next reads that from the module,
 * so the wrapper cannot set it).
 */

export interface RouteInput<TBody> {
  body: TBody;
  params: Record<string, string>;
  request: Request;
  url: URL;
}

export interface RouteResult<TOut> {
  status?: number;
  body: TOut;
}

export interface RouteOptions<TBody> {
  body?: ZodType<TBody>;
  /** Claims an idempotency key when the client sends one. Set on every POST/DELETE. */
  mutating?: boolean;
  /** Map core's "not on shift" refusal to 409 `not_on_shift` (positions only). */
  notOnShift?: boolean;
  logPrefix?: string;
}

export type RouteHandler<TBody, TOut> = (
  ctx: ApiContext,
  input: RouteInput<TBody>,
) => Promise<RouteResult<TOut>>;

type NextRouteContext = { params: Promise<Record<string, string>> };

export function apiRoute<TBody = undefined, TOut = unknown>(
  options: RouteOptions<TBody>,
  handler: RouteHandler<TBody, TOut>,
): (request: Request, routeContext: NextRouteContext) => Promise<NextResponse> {
  return async (request, routeContext) => {
    const logPrefix = options.logPrefix ?? "[api]";
    let ctx: ApiContext;
    try {
      ctx = await resolveApiContext(request);
    } catch (error) {
      return errorResponse(toApiHttpError(error, { logPrefix }));
    }

    const url = new URL(request.url);
    const params = (await routeContext.params) ?? {};

    let body: TBody;
    try {
      body = await parseBody(request, options.body);
    } catch (error) {
      return errorResponse(toApiHttpError(error, { logPrefix }));
    }

    const key = options.mutating ? idempotencyKeyOf(request) : null;
    if (key instanceof ApiHttpError) return errorResponse(key);

    const route = `${request.method.toUpperCase()} ${url.pathname}`;
    if (key) {
      try {
        const claim = await claimIdempotencyKey(ctx.core.db, {
          userId: ctx.session.userId,
          key,
          route,
          requestHash: hashBody(body),
          now: ctx.now,
        });
        if (claim.state === "replay") {
          return NextResponse.json(claim.body, { status: claim.status });
        }
        if (claim.state === "in_progress") {
          return errorResponse(
            new ApiHttpError(
              "idempotency_in_progress",
              "That request is still being processed.",
            ),
          );
        }
        if (claim.state === "mismatch") {
          return errorResponse(
            new ApiHttpError(
              "idempotency_mismatch",
              "That idempotency key was already used for a different request.",
            ),
          );
        }
      } catch (error) {
        return errorResponse(toApiHttpError(error, { logPrefix }));
      }
    }

    let status: number;
    let payload: unknown;
    try {
      const result = await handler(ctx, { body, params, request, url });
      status = result.status ?? 200;
      payload = result.body;
    } catch (error) {
      const mapped = toApiHttpError(error, {
        logPrefix,
        ...(options.notOnShift ? { notOnShift: true } : {}),
      });
      status = mapped.status;
      payload = mapped.body;
    }

    if (key) {
      await settleIdempotency(ctx, key, status, payload);
    }
    return NextResponse.json(payload, { status });
  };
}

async function parseBody<TBody>(
  request: Request,
  schema?: ZodType<TBody>,
): Promise<TBody> {
  if (!schema) return undefined as TBody;
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.map(String).join(".")})` : "";
    throw new ApiHttpError(
      "invalid_body",
      `${issue?.message ?? "Invalid request."}${where}`,
    );
  }
  return parsed.data;
}

function idempotencyKeyOf(request: Request): string | null | ApiHttpError {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) return null;
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return new ApiHttpError("invalid_body", `${IDEMPOTENCY_HEADER} is too long.`);
  }
  return key;
}

/** Sorted-key JSON so the same body always hashes the same. */
export function hashBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/**
 * Store 2xx and 4xx (the client must not retry either); release on 5xx so
 * the next attempt runs for real. Never lets a bookkeeping failure turn a
 * finished action into an error the driver sees.
 */
async function settleIdempotency(
  ctx: ApiContext,
  key: string,
  status: number,
  payload: unknown,
): Promise<void> {
  try {
    if (status >= 500) {
      await releaseIdempotencyKey(ctx.core.db, { userId: ctx.session.userId, key });
    } else {
      await completeIdempotencyKey(ctx.core.db, {
        userId: ctx.session.userId,
        key,
        status,
        body: payload,
        now: ctx.now,
      });
    }
  } catch (error) {
    console.error("[api] idempotency bookkeeping failed", error);
  }
}

function errorResponse(error: ApiHttpError): NextResponse {
  const body: ApiError = error.body;
  return NextResponse.json(body, { status: error.status });
}
