import { BUCKETS, getActiveShift } from "@koolee/core";
import type { MeResponse } from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { signUrl } from "../storage";
import { serializeActiveShift } from "./shift";

/**
 * `GET /api/v1/me` — the identity the session resolved plus the one thing
 * every screen's header needs, the active shift. Re-read per request, so a
 * revoked `can_drive` or a deactivated account shows on the next call.
 */
export async function readMe(ctx: ApiContext): Promise<MeResponse> {
  const [active, avatarUrl] = await Promise.all([
    getActiveShift(ctx.core.db, ctx.session.userId),
    signUrl(
      ctx.supabase,
      BUCKETS.avatars.id,
      ctx.identity.avatarStoragePath,
      BUCKETS.avatars.signedUrlTtlSeconds,
    ),
  ]);
  return {
    userId: ctx.session.userId,
    email: ctx.identity.email,
    fullName: ctx.identity.fullName,
    avatarUrl,
    avatarStoragePath: ctx.identity.avatarStoragePath,
    canDrive: ctx.identity.canDrive,
    shift: serializeActiveShift(active),
    serverTime: ctx.now.toISOString(),
  };
}
