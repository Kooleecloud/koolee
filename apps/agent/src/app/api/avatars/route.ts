import { NextResponse } from "next/server";
import {
  AVATAR_UPLOAD_COPY,
  clearUserAvatar,
  handleAvatarUpload,
  setUserAvatar,
} from "@koolee/core";

import { uploadAvatar } from "@/lib/avatars";
import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Buffering the upload wants Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * The agent's profile picture — the same contract as the customer app's route,
 * because they share `AvatarUploader` and `handleAvatarUpload`. Only the
 * session resolution differs: this one requires an active `staff_members` row
 * with role `agent`, re-checked per request like every other agent surface, so
 * a deactivated account cannot still set a face on the customer's trip page.
 */

const UNAVAILABLE = "Profile pictures aren't available in this environment yet.";

export async function POST(request: Request) {
  const session = await getAgentSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const core = tryGetCore();
  if (!core) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  let file: { data: Uint8Array; mimeType: string } | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("avatar");
    if (entry instanceof File && entry.size > 0) {
      file = {
        data: new Uint8Array(await entry.arrayBuffer()),
        mimeType: entry.type || "application/octet-stream",
      };
    }
  } catch {
    return NextResponse.json({ error: AVATAR_UPLOAD_COPY.missing }, { status: 400 });
  }

  const outcome = await handleAvatarUpload(
    {
      userId: session.userId,
      storage: { upload: (input) => uploadAvatar(input) },
      recordAvatar: async (storagePath) => {
        await setUserAvatar(core.db, { userId: session.userId, storagePath });
      },
    },
    file,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await getAgentSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const core = tryGetCore();
  if (!core) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  try {
    await clearUserAvatar(core.db, session.userId);
  } catch (error) {
    console.error("[avatars] clear failed", error);
    return NextResponse.json(
      { error: AVATAR_UPLOAD_COPY.storageFailed },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
