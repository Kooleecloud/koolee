import { redirect } from "next/navigation";
import { PageHeader } from "@koolee/ui";
import { getCustomerById, listBookings } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";

import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/**
 * Optional profile completion. Name prefills from the passenger name on the
 * latest booking (extracted from the ticket), address from the latest pickup
 * address. Nothing in v1 requires any of it.
 */
export default async function ProfilePage() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    redirect("/login?returnTo=%2Fdashboard%2Fprofile");
  }

  const core = tryGetCore();
  const userRow = core
    ? await getCustomerById(core.db, authUser.id).catch(() => null)
    : null;

  let paxName = "";
  let address = { line1: "", line2: "", city: "", state: "", zip: "" };
  if (core) {
    try {
      const [latest] = await listBookings(core.db, { userId: authUser.id, limit: 1 });
      if (latest) {
        paxName = latest.paxName;
        const pickup = await core.db.query.addresses.findFirst({
          where: (t, { eq }) => eq(t.id, latest.pickupAddressId),
        });
        if (pickup) {
          address = {
            line1: pickup.line1,
            line2: pickup.line2 ?? "",
            city: pickup.city,
            state: pickup.state,
            zip: pickup.zip,
          };
        }
      }
    } catch {
      // Prefill is a nicety — an empty form is fine.
    }
  }

  const email = userRow?.email ?? authUser.email ?? "";

  return (
    <>
      <PageHeader
        title="Your profile"
        subtitle="Entirely optional — it just makes your next booking faster."
      />

      <ProfileForm
        defaults={{
          fullName: userRow?.fullName ?? paxName,
          email,
          emailLocked: Boolean(email),
          ...address,
        }}
      />
    </>
  );
}
