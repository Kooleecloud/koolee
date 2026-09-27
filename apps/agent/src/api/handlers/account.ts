import { BUCKETS, clearUserAvatar, setUserAvatar } from "@koolee/core";
import type { AvatarResponse } from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { assertObjectExists, assertPathUnderPrefix, signUrl } from "../storage";

/**
 * Account handlers — the agent's own profile picture.
 *
 * Unlike `app/api/avatars/route.ts`, no bytes pass through here: the app
 * uploads straight to the `avatars` bucket under its own session (migration
 * 0027 lets a user write only into `<userId>/`), then tells us the key. The
 * two storage checks run BEFORE the row is touched so a forged or mistyped
 * key can never point this profile at nothing — or at someone else's face.
 * `setUserAvatar` re-checks the prefix on its side too; that is deliberate
 * belt-and-braces, not redundancy to trim.
 */

const SPEC = BUCKETS.avatars;

export async function setAvatar(
  ctx: ApiContext,
  input: { storagePath: string },
): Promise<AvatarResponse> {
  const { userId } = ctx.session;
  assertPathUnderPrefix(input.storagePath, `${userId}/`);
  await assertObjectExists(ctx.supabase, SPEC.id, input.storagePath);

  await setUserAvatar(ctx.core.db, { userId, storagePath: input.storagePath });

  return {
    ok: true,
    avatarStoragePath: input.storagePath,
    avatarUrl: await signUrl(
      ctx.supabase,
      SPEC.id,
      input.storagePath,
      SPEC.signedUrlTtlSeconds,
    ),
  };
}

export async function clearAvatar(ctx: ApiContext): Promise<AvatarResponse> {
  await clearUserAvatar(ctx.core.db, ctx.session.userId);
  return { ok: true, avatarStoragePath: null, avatarUrl: null };
}
