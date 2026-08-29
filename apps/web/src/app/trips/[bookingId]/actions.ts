"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { acceptAgreement, NotAuthorizedError, NotFoundError } from "@koolee/core";

import { getCore } from "@/lib/core";
import { getCustomerSession } from "@/lib/session";

/**
 * Accepting the booking agreement, from the trip page.
 *
 * The version is NOT a form field. `acceptAgreement` resolves the current
 * version server-side, so a page left open across a publish cannot accept the
 * stale terms it happens to be rendering — which is the point of versioning
 * the agreement at all.
 */

export interface AcceptAgreementState {
  error?: string;
  ok?: boolean;
}

/**
 * Evidence is whatever the request actually carried, and nothing else.
 *
 * `x-forwarded-for` is absent in local development and present behind Vercel;
 * when it is absent the key is OMITTED rather than filled with "unknown" or a
 * placeholder address. An invented IP in a record we would produce in a
 * dispute is worse than an honest gap.
 */
async function evidenceFromRequest(): Promise<Record<string, unknown>> {
  const h = await headers();
  const userAgent = h.get("user-agent");
  // First hop is the client; the rest are proxies.
  const forwardedFor = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(forwardedFor ? { ip: forwardedFor } : {}),
  };
}

export async function acceptAgreementAction(
  _prev: AcceptAgreementState,
  form: FormData,
): Promise<AcceptAgreementState> {
  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) return { error: "Something went wrong — please reload the page." };

  const session = await getCustomerSession();
  if (!session) return { error: "Please sign in again to accept." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "We can't record that right now. Please try again shortly." };
  }

  try {
    await acceptAgreement(core, {
      bookingId,
      userId: session.userId,
      evidence: await evidenceFromRequest(),
    });
    revalidatePath(`/trips/${bookingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "We couldn't find that trip." };
    if (error instanceof NotAuthorizedError) return { error: error.message };
    console.error("[trips] agreement accept failed", error);
    return { error: "We couldn't record that. Please try again." };
  }
}
