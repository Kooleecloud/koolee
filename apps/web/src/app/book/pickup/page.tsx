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
          line1: draft.line1 ?? "",
          line2: draft.line2 ?? "",
          city: draft.city ?? "",
          state: draft.state ?? "",
          zip: draft.zip ?? "",
          lat: draft.lat ?? null,
          lng: draft.lng ?? null,
          placeId: draft.placeId ?? null,
          bagCount: draft.bagCount ?? 1,
        }}
      />
    </div>
  );
}
