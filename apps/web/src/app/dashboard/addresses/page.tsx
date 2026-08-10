import { redirect } from "next/navigation";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listAddressesForSession, type Address } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

import { AddAddressForm, DeleteAddressButton, EditAddressForm } from "./address-forms";

export const metadata = { title: "Saved addresses" };
export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    redirect("/login?returnTo=%2Fdashboard%2Faddresses");
  }

  const core = tryGetCore();
  let saved: Address[] = [];
  let unavailable = core === null;
  if (core) {
    try {
      saved = await listAddressesForSession(
        core.db,
        customerSessionFromAuthUser(authUser),
      );
    } catch {
      unavailable = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Saved addresses"
        subtitle="Pickup addresses you can reuse when booking. All must be inside our service area."
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {unavailable ? (
          <DatabaseNotConfigured />
        ) : saved.length === 0 ? (
          <EmptyState
            title="No saved addresses"
            description="Add a pickup address and it'll be one tap at booking time."
          />
        ) : (
          <Accordion type="single" collapsible className="flex flex-col gap-3">
            {saved.map((address) => (
              <AccordionItem
                key={address.id}
                value={address.id}
                className="rounded-xl border border-border bg-white px-4 shadow-xs"
              >
                <div className="flex items-center justify-between gap-3">
                  <AccordionTrigger className="flex-1 text-left">
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {address.label || address.line1}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}, {address.city}{" "}
                        {address.state} {address.zip}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <DeleteAddressButton addressId={address.id} />
                </div>
                <AccordionContent className="pb-4">
                  <EditAddressForm address={address} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        <AddAddressForm />
      </div>

      {/* TODO(account): saved payment methods (Stripe Customers/SetupIntents),
          notification preferences, and account deletion are deliberately out
          of scope for v1. */}
    </div>
  );
}
