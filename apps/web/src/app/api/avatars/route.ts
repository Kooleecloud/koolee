import { NextResponse } from "next/server";
import {
  AVATAR_UPLOAD_COPY,
  clearUserAvatar,
  handleAvatarUpload,
  setUserAvatar,
} from "@koolee/core";

import { uploadAvatar } from "@/lib/avatars";
import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";

export const dynamic = "force-dynamic";
/** Buffering the upload wants Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * The customer's profile picture.
 *
 * A route rather than a Server Action for the same reason
 * `/api/passport-photos` is one: Server Actions cap the request body at 1 MB,
 * and a browser that cannot downscale hands back the untouched camera capture,
 * which would 413 before any of our code ran and produce an error the customer
 * can do nothing with. Here it is refused politely with a sentence instead.
 *
 * ANONYMOUS USERS ARE REFUSED. A funnel session is a booking in progress, not
 * an account — there is no profile for it to belong to, and letting one write
 * into the avatars bucket would put objects under a user id that gets garbage
 * collected.
 */

const UNAVAILABLE = "Profile pictures aren't available in this environment yet.";

export async function POST(request: Request) {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
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
      userId: authUser.id,
      storage: { upload: (input) => uploadAvatar(input) },
      recordAvatar: async (storagePath) => {
        await setUserAvatar(core.db, { userId: authUser.id, storagePath });
      },
    },
    file,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true });
}

/**
 * "Remove my picture" — a DISPLAY decision, so it clears the pointer and
 * leaves the object alone. Purging the bytes is a retention decision, and the
 * two are not the same request.
 */
export async function DELETE() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const core = tryGetCore();
  if (!core) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  try {
    await clearUserAvatar(core.db, authUser.id);
  } catch (error) {
    console.error("[avatars] clear failed", error);
    return NextResponse.json(
      { error: AVATAR_UPLOAD_COPY.storageFailed },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
