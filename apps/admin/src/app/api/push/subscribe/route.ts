import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletePushSubscription,
  markPushSubscriptionVerified,
  savePushSubscription,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Web Push subscription registration for the ops console.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, and that is forced rather than
 * preferred: the service worker's `pushsubscriptionchange` handler has to
 * re-register a rotated subscription, and a service worker can only `fetch` a
 * URL — it has no React, no form, and no way to invoke a Server Action. One
 * endpoint therefore serves both the page and the worker, so the two can
 * never drift.
 *
 * AUTHORIZATION. The user is derived from the SESSION on every request and
 * never from the body. A caller can only ever create, verify or delete a
 * subscription of their own; there is no field in the payload that names a
 * user, so there is nothing to forge.
 *
 * PUSH IS NEVER LOAD-BEARING. A failure here costs the notification channel
 * and nothing else — email and the in-app signal are untouched.
 */

export const dynamic = "force-dynamic";

/** Exactly what `PushSubscription.toJSON()` produces, and nothing more. */
const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  /** Free text shown back to the person managing their devices. */
  label: z.string().max(120).optional(),
});

const unsubscribeSchema = z.object({ endpoint: z.url() });

/** The "I did see it" answer to the test push. */
const verifySchema = z.object({ endpoint: z.url(), seen: z.literal(true) });

async function userIdOrNull(): Promise<string | null> {
  try {
    return (await requireAdminSession()).userId;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await userIdOrNull();
  if (!userId) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const { id } = await savePushSubscription(getCore(), {
      userId,
      endpoint: parsed.data.subscription.endpoint,
      p256dh: parsed.data.subscription.keys.p256dh,
      auth: parsed.data.subscription.keys.auth,
      app: "admin",
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("[push] subscribe failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/**
 * Records that a human CONFIRMED they saw the test notification.
 *
 * The only trustworthy signal this channel works: permission can be granted,
 * the push delivered, the worker fired and `showNotification` resolved with
 * the screen staying empty (an OS per-app switch, Focus, an alert style of
 * "None" — all invisible to JavaScript).
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const userId = await userIdOrNull();
  if (!userId) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const updated = await markPushSubscriptionVerified(getCore(), {
      userId,
      endpoint: parsed.data.endpoint,
    });
    return NextResponse.json({ ok: updated });
  } catch (error) {
    console.error("[push] verify failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const userId = await userIdOrNull();
  if (!userId) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    // Scoped by user as well as endpoint in core, so somebody else's endpoint
    // is indistinguishable from one that was never there.
    const removed = await deletePushSubscription(getCore(), {
      userId,
      endpoint: parsed.data.endpoint,
    });
    return NextResponse.json({ ok: removed });
  } catch (error) {
    console.error("[push] unsubscribe failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
