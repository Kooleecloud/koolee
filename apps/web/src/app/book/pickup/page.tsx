import { redirect } from "next/navigation";
import { PageHeader } from "@koolee/ui";
import { listAddressesForSession, type Address } from "@koolee/core";

import { PickupStepForm } from "@/components/pickup-step-form";
import { getAuthUser } from "@/lib/auth";
import { readDraft } from "@/lib/booking-draft";
import { nextIncompleteStep, stepIsUnlocked } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

export const metadata = { title: "Pickup details" };
export const dynamic = "force-dynamic";

export default async function PickupStepPage() {
  const draft = await readDraft();
  /** What they typed at this step last time, if we refused it. */
  const rejected = draft.pickupEntry;
  if (!stepIsUnlocked(draft, "/book/pickup")) {
    redirect(nextIncompleteStep(draft));
  }

  // Logged-in customers get their saved addresses as one-tap prefills; the
  // guest flow below is unchanged.
  let saved: Address[] = [];
  const authUser = await getAuthUser();
  const core = tryGetCore();
  if (authUser && !authUser.isAnonymous && core) {
    saved = await listAddressesForSession(
      core.db,
      customerSessionFromAuthUser(authUser),
    ).catch(() => []);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pickup details"
        subtitle="Where should we collect your bags, and how many are we sealing?"
      />

      <PickupStepForm
        savedAddresses={saved.map((address) => ({
          id: address.id,
          label: address.label ?? null,
          line1: address.line1,
          line2: address.line2 ?? null,
          city: address.city,
          state: address.state,
          zip: address.zip,
          // Carried so re-using a saved address keeps whatever precision it
          // already has, instead of falling back to its ZIP's centroid.
          lat: address.lat,
          lng: address.lng,
          placeId: address.placeId,
        }))}
        defaults={{
          /*
           * `pickupEntry` wins wherever it exists. It is only ever set when
           * the LAST submit was refused — an uncovered ZIP, a missing street,
           * a bag count out of range — and it holds the fresher keystrokes;
           * `submitPickup` clears it the moment the step succeeds.
           *
           * Without it a refusal cost the whole address. The waitlist card
           * replaces the form and its "Try another ZIP" is a real link back
           * to this page, which re-read a draft that only ever held an
           * address we had already ACCEPTED.
           */
          line1: rejected?.line1 ?? draft.line1 ?? "",
          line2: rejected?.line2 ?? draft.line2 ?? "",
          city: rejected?.city ?? draft.city ?? "",
          state: rejected?.state ?? draft.state ?? "",
          zip: rejected?.zip ?? draft.zip ?? "",
          /*
           * Precision is NOT restored from a rejection, and that is not an
           * oversight. These belong to an address the customer is about to
           * change; coordinates from the previous attempt would point a
           * driver at the wrong door while looking exactly as confident. The
           * ZIP centroid is the honest fallback until they pick a suggestion
           * again.
           */
          lat: rejected ? null : (draft.lat ?? null),
          lng: rejected ? null : (draft.lng ?? null),
          placeId: rejected ? null : (draft.placeId ?? null),
          bagCount: Number(rejected?.bagCount) || draft.bagCount || 1,
        }}
      />
    </div>
  );
}
