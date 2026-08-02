import "server-only";

import { optionalEnv } from "@/env";

/**
 * Cloudflare Turnstile server-side verification.
 *
 * Supabase's `updateUser` (the anonymous → phone upgrade) does not take a
 * captchaToken, so the OTP-sending actions verify the token themselves against
 * siteverify BEFORE any Supabase call and reject without it.
 *
 * When TURNSTILE_SECRET_KEY is not configured the check passes open with a
 * one-line warning — the scaffold's zero-credential convention. Configure the
 * key (Cloudflare's always-pass test secret works locally) to enforce.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerification {
  ok: boolean;
  /** "not_configured" | "missing_token" | "rejected" | "unreachable" */
  reason?: string;
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  options: { remoteIp?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileVerification> {
  const secret = optionalEnv("TURNSTILE_SECRET_KEY");
  if (!secret) {
    console.warn(
      "[turnstile] TURNSTILE_SECRET_KEY not configured — skipping bot check.",
    );
    return { ok: true, reason: "not_configured" };
  }

  if (!token) return { ok: false, reason: "missing_token" };

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({ secret, response: token });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);

  try {
    const response = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await response.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    // Cloudflare unreachable: fail closed — a bot check that silently passes
    // during an outage is not a bot check.
    return { ok: false, reason: "unreachable" };
  }
}
