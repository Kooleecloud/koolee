import { NextResponse } from "next/server";

/**
 * The VAPID public key, for the SERVICE WORKER only.
 *
 * The page gets the key as a prop (the app reads the inlined
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and hands it to `useWebPush`). A service
 * worker cannot: it outlives the page that registered it, it has no props,
 * and `pushsubscriptionchange` fires when no page is open at all. So the
 * rotation handler fetches it here.
 *
 * Unauthenticated on purpose. It is a PUBLIC key — it is already in every
 * client bundle, and it authenticates Koolee TO the push service, not the
 * other way round. Gating it would only break the worker.
 */

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    // 503, not 404: the route exists, the environment is not configured.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
