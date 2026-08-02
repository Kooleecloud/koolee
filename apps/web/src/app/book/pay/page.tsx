import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
} from "@koolee/ui";
import { getCustomerById } from "@koolee/core";

import { confirmBooking } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { StripeCheckoutPlaceholder } from "@/components/stripe-checkout";
import { nextIncompleteStep, readDraft } from "@/lib/booking-draft";
import { getAuthUser } from "@/lib/auth";
import { hasStripeCheckout, tryGetCore } from "@/lib/core";
import { maskPhone } from "@/lib/phone";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

export default async function PayStepPage() {
  const draft = await readDraft();
  if (nextIncompleteStep(draft) !== "/book/price") {
    redirect(nextIncompleteStep(draft));
  }

  // Belt (the proxy is braces): payment requires a verified session.
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/book/verify");

  const core = tryGetCore();
  const userRow = core
    ? await getCustomerById(core.db, authUser.id).catch(() => null)
    : null;
  const verifiedPhone = userRow?.phone ?? authUser.phone;
  // Email-only customers: the driver still needs a number for pickup day.
  const needsContactPhone = !verifiedPhone;

  const stripeReady = hasStripeCheckout();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment"
        subtitle="We authorize the amount now and only charge you when an agent has collected your bags."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your booking</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Flight</dt>
            <dd>
              {draft.flightNumber} from {draft.departureAirport}
            </dd>
            <dt className="text-muted-foreground">Passenger</dt>
            <dd>{draft.paxName}</dd>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd>
              {draft.line1}
              {draft.line2 ? `, ${draft.line2}` : ""}, {draft.city} {draft.state}{" "}
              {draft.zip}
            </dd>
            <dt className="text-muted-foreground">Bags</dt>
            <dd>{draft.bagCount}</dd>
            <dt className="text-muted-foreground">Updates</dt>
            <dd>
              {verifiedPhone ? (
                <>
                  Texts to {maskPhone(verifiedPhone)} —{" "}
                  <Link href="/book/verify" className="underline underline-offset-4">
                    change
                  </Link>
                </>
              ) : (
                <>Email to {userRow?.email ?? authUser.email}</>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {stripeReady ? (
        <StripeCheckoutPlaceholder />
      ) : (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Development payment</CardTitle>
            <CardDescription>
              No Stripe keys are configured, so this booking uses{" "}
              <code>FakePaymentProvider</code>. No card is collected and no money moves.
              Set <code>STRIPE_SECRET_KEY</code> and{" "}
              <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to switch to real Stripe
              Elements.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <StepForm
        action={confirmBooking}
        submitLabel={stripeReady ? "Authorize and book" : "Book with test payment"}
      >
        {needsContactPhone && (
          <div className="grid gap-2">
            <Label htmlFor="contactPhone">
              Contact number for the driver on pickup day
            </Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              inputMode="tel"
              placeholder="+1 (212) 555-0100"
              autoComplete="tel"
              required
            />
            <p className="text-xs text-muted-foreground">
              Any number the driver can call at the door — no verification needed.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          By booking you agree that Koolee collects your bags and delivers them to your
          airline&apos;s bag drop. You check in with your airline as usual.
        </p>
      </StepForm>
    </div>
  );
}
