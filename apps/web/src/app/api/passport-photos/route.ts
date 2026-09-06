import { NextResponse } from "next/server";
import { ConflictError, NotFoundError, recordCustomerUpload } from "@koolee/core";

import { getCore } from "@/lib/core";
import { uploadPassportPhoto } from "@/lib/passport-photos";
import { getCustomerSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Buffering the upload wants Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * The customer's optional passport pre-upload.
 *
 * A route rather than a Server Action, matching `/api/ticket-uploads`: Server
 * Actions cap the request body at 1 MB, and while the browser downscales
 * first, a browser that CANNOT downscale (no `createImageBitmap`, a decode
 * failure) hands back the original 5 MB capture — which would 413 before any
 * of our code ran, producing an error the customer can do nothing with. The
 * route accepts it and refuses politely with a sentence instead.
 *
 * Order matters: store first, then record. A `passport_verifications` row
 * pointing at an object that failed to upload is a broken image on the trip
 * page and a photo the agent expects to find and cannot.
 *
 * Authorization is core's: `recordCustomerUpload` resolves the booking by
 * owner and 404s on anyone else's.
 */

/** Comfortably above what the browser downscale produces (~700 KB). */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const COPY = {
  missing: "Choose a photo of your passport page.",
  tooLarge: "That photo is too large — keep it under 8 MB.",
  badType: "Photos must be JPEG, PNG, or WebP.",
  storageFailed: "Something went wrong saving the photo. Please try again.",
  unavailable: "Passport uploads aren't available in this environment yet.",
} as const;

export async function POST(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  let core;
  try {
    core = getCore();
  } catch {
    return NextResponse.json({ error: COPY.unavailable }, { status: 503 });
  }

  let bookingId: string;
  let file: File;
  try {
    const form = await request.formData();
    bookingId = String(form.get("bookingId") ?? "");
    const entry = form.get("passport");
    if (!bookingId || !(entry instanceof File) || entry.size === 0) {
      return NextResponse.json({ error: COPY.missing }, { status: 400 });
    }
    file = entry;
  } catch {
    return NextResponse.json({ error: COPY.missing }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: COPY.tooLarge }, { status: 413 });
  }
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return NextResponse.json({ error: COPY.badType }, { status: 415 });
  }

  const storagePath = await uploadPassportPhoto({
    bookingId,
    data: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    extension,
  });
  if (!storagePath) {
    return NextResponse.json({ error: COPY.storageFailed }, { status: 503 });
  }

  try {
    await recordCustomerUpload(core, {
      bookingId,
      userId: session.userId,
      storagePath,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[passport-photos] recordCustomerUpload failed", error);
    return NextResponse.json({ error: COPY.storageFailed }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
