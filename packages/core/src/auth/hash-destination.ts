import { createHmac } from "node:crypto";

/**
 * Server-only. Produces a stable, non-reversible identifier for OTP rate
 * limiting (`otp_send_log.destination_hash`). The plaintext destination is
 * never persisted.
 *
 * Normalization lives HERE and nowhere else: the write path (insert) and the
 * read path (per-destination count) must hash identically or the limit
 * silently stops matching. Do not normalize at call sites.
 *
 * The `${kind}:` prefix keeps a phone and an email that happen to share a
 * string from sharing a rate-limit bucket.
 */
export function hashDestination(destination: string, kind: "phone" | "email"): string {
  const key = process.env.OTP_LOG_HMAC_KEY;
  if (!key) throw new Error("OTP_LOG_HMAC_KEY is not set");

  const normalized =
    kind === "phone"
      ? destination.replace(/[^\d+]/g, "") // caller already supplies E.164
      : destination.trim().toLowerCase();

  return createHmac("sha256", key).update(`${kind}:${normalized}`).digest("hex");
}
