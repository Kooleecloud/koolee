import { redirect } from "next/navigation";

import { readDraft } from "@/lib/booking-draft";
import { nextIncompleteStep, stepIsUnlocked } from "@/lib/booking-steps";
import { getAuthUser } from "@/lib/auth";

import { VerifyFlow } from "./verify-flow";

export const metadata = { title: "Pickup updates" };
export const dynamic = "force-dynamic";

/**
 * The only auth wall in the product: Screen A (phone/email entry) and
 * Screen B (OTP), rendered inside the review & pay step right before payment.
 */
export default async function VerifyStepPage() {
  const draft = await readDraft();
  if (!stepIsUnlocked(draft, "/book/pay")) {
    redirect(nextIncompleteStep(draft));
  }

  // A verified session normally skips this step from the price screen; landing
  // here directly is the "change number" path, which the flow supports.
  const authUser = await getAuthUser();

  return (
    <VerifyFlow
      alreadyVerified={Boolean(authUser && !authUser.isAnonymous)}
      hasSession={Boolean(authUser)}
    />
  );
}
