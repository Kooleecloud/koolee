import { NextResponse } from "next/server";
import {
  AVATAR_UPLOAD_COPY,
  canReplaceAvatarOf,
  clearUserAvatar,
  handleAvatarUpload,
  setUserAvatar,
} from "@koolee/core";

import { uploadAvatar, uploadAvatarAsService } from "@/lib/avatars";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Buffering the upload wants Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * Profile pictures from the console — the operator's own, and any staff
 * member's.
 *
 * The own-photo path is byte-for-byte the same flow as the customer and agent
 * routes: all three post to `AvatarUploader` and run `handleAvatarUpload`.
 * Only the session resolution differs — this one requires an active
 * `staff_members` row with role `admin`, re-checked per request, so a
 * deactivated operator cannot still change the face the console shows.
 *
 * THE ON-BEHALF PATH (`?userId=`) is the one thing the console can do that no
 * other app can, and it needs two things the own-photo path does not:
 *
 *  1. **A code-side authorization check.** Migration 0027's insert policy is
 *     "your own folder, whoever you are", so RLS refuses a cross-folder write
 *     and cannot be the gate. `canReplaceAvatarOf` is: an admin, acting on a
 *     member of ACTIVE STAFF. A customer's photo is out of reach on purpose —
 *     it is their face, and editing it would be a moderation capability this
 *     product has decided not to have in v1.
 *  2. **The service-role client**, for the same reason. It is used only after
 *     the check above, never before.
 *
 * The object key is still built from the SUBJECT's id (`handleAvatarUpload`
 * derives it from `deps.userId`), so `setUserAvatar`'s own prefix assertion
 * still holds and a bug here fails loudly rather than pointing one person's
 * profile at another person's face.
 */

const UNAVAILABLE = "Profile pictures aren't available in this environment yet.";
const NOT_PERMITTED = "You can only change a photo for a member of staff.";

/** The subject of this request: the operator, or a staff member they may edit. */
async function resolveSubject(request: Request, viewerUserId: string) {
  const requested = new URL(request.url).searchParams.get("userId");
  return {
    subjectUserId: requested?.trim() || viewerUserId,
    onBehalf: Boolean(requested),
  };
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const core = tryGetCore();
  if (!core) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  const { subjectUserId, onBehalf } = await resolveSubject(request, session.userId);
  if (onBehalf && !(await canReplaceAvatarOf(core.db, session, subjectUserId))) {
    return NextResponse.json({ error: NOT_PERMITTED }, { status: 403 });
  }

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
      userId: subjectUserId,
      storage: {
        // Own photo goes over the anon key so RLS stays the gate; somebody
        // else's cannot, and has already passed the check above.
        upload: (input) =>
          onBehalf ? uploadAvatarAsService(input) : uploadAvatar(input),
      },
      recordAvatar: async (storagePath) => {
        await setUserAvatar(core.db, { userId: subjectUserId, storagePath });
      },
    },
    file,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const core = tryGetCore();
  if (!core) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  const { subjectUserId, onBehalf } = await resolveSubject(request, session.userId);
  if (onBehalf && !(await canReplaceAvatarOf(core.db, session, subjectUserId))) {
    return NextResponse.json({ error: NOT_PERMITTED }, { status: 403 });
  }

  try {
    // Clears the POINTER, never the object — same rule as everywhere else:
    // removing a picture is a display decision, purging bytes is a retention
    // decision, and they are not the same request.
    await clearUserAvatar(core.db, subjectUserId);
  } catch (error) {
    console.error("[avatars] clear failed", error);
    return NextResponse.json(
      { error: AVATAR_UPLOAD_COPY.storageFailed },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
