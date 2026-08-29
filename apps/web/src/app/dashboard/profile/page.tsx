import { redirect } from "next/navigation";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Card,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
  VerifiedIndicator,
} from "@koolee/ui";
import {
  getCustomerById,
  listAddressesForSession,
  listBookingsForSession,
  type Address,
} from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { customerSessionFromAuthUser } from "@/lib/session";

import {
  AddAddressForm,
  DeleteAddressButton,
  EditAddressForm,
} from "../addresses/address-forms";
import { ConfirmEmailForm } from "./confirm-email-form";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/** One contact channel: label, value, and whether it is verified. */
function ContactRow({
  label,
  value,
  verified,
}: {
  label: string;
  value: string | null | undefined;
  verified: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {value || <span className="text-muted-foreground">none</span>}
        {value ? <VerifiedIndicator subject={label} verified={verified} /> : null}
      </span>
    </div>
  );
}

/**
 * Account page: one card for name + verified contact channels, then saved
 * addresses below it. `/dashboard/addresses` redirects here — they were two
 * pages describing the same account.
 *
 * Phone and email stay read-only: changing either re-runs verification through
 * the funnel's guarded OTP path, never a second mechanism (see actions.ts).
 * Name is the editable field inside the same card, which is why it has no
 * read-only row of its own.
 */
export default async function ProfilePage() {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    redirect("/login?returnTo=%2Fdashboard%2Fprofile");
  }

  const core = tryGetCore();
  const session = customerSessionFromAuthUser(authUser);
  const userRow = core
    ? await getCustomerById(core.db, authUser.id).catch(() => null)
    : null;

  // Name prefills from the latest booking's passenger name — a nicety.
  let paxName = "";
  if (core && !userRow?.fullName) {
    try {
      const [latest] = await listBookingsForSession(core.db, session, { limit: 1 });
      if (latest) paxName = latest.paxName;
    } catch {
      // Empty form is fine.
    }
  }

  let saved: Address[] = [];
  let addressesUnavailable = core === null;
  if (core) {
    try {
      saved = await listAddressesForSession(core.db, session);
    } catch {
      addressesUnavailable = true;
    }
  }

  const phone = userRow?.phone ?? authUser.phone ?? "";
  const email = userRow?.email ?? authUser.email ?? "";
  const phoneVerified = Boolean(userRow?.phoneVerifiedAt);
  const emailVerified = Boolean(userRow?.emailVerifiedAt);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Your profile"
        subtitle="Your contact details, how your name appears, and your saved pickup addresses."
      />

      <ProfileForm
        defaults={{
          fullName: userRow?.fullName ?? paxName,
          email: emailVerified ? "" : email,
          emailLocked: Boolean(email),
        }}
        contact={
          <div className="flex flex-col gap-3 text-sm">
            <ContactRow label="Phone" value={phone} verified={phoneVerified} />
            <ContactRow label="Email" value={email} verified={emailVerified} />
            {/* The code field lives here rather than behind a button: anyone
                who already has the email in hand can finish in one step. */}
            {email && !emailVerified ? <ConfirmEmailForm email={email} /> : null}
            {phone && !phoneVerified ? (
              <p className="text-xs text-muted-foreground">
                Your phone still needs verifying. That happens in the booking verification
                step.
              </p>
            ) : null}
          </div>
        }
      />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-navy-800">Saved addresses</h2>
          <p className="text-sm text-muted-foreground">
            Pickup addresses you can reuse when booking. All must be inside our service
            area.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          {addressesUnavailable ? (
            <DatabaseNotConfigured />
          ) : saved.length === 0 ? (
            <EmptyState
              title="No saved addresses"
              description="Add a pickup address and it'll be one tap at booking time."
            />
          ) : (
            <Accordion type="single" collapsible className="flex flex-col gap-3">
              {saved.map((address) => (
                <Card asChild key={address.id}>
                  <AccordionItem value={address.id} className="px-4">
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
                </Card>
              ))}
            </Accordion>
          )}

          <AddAddressForm />
        </div>
      </section>

      {/* TODO(account): saved payment methods (Stripe Customers/SetupIntents),
          notification preferences, and account deletion are deliberately out
          of scope for v1. */}
    </div>
  );
}
