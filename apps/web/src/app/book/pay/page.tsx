import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

import { confirmBooking } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { StripeCheckoutPlaceholder } from "@/components/stripe-checkout";
import { nextIncompleteStep, readDraft } from "@/lib/booking-draft";
import { hasStripeCheckout } from "@/lib/core";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

export default async function PayStepPage() {
  const draft = await readDraft();
  const nextStep = nextIncompleteStep(draft);

  if (nextStep !== "/book/pay") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your booking is incomplete</CardTitle>
          <CardDescription>Finish the earlier steps first.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={nextStep}>Continue where you left off</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stripeReady = hasStripeCheckout();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Payment</h1>
        <p className="text-sm text-muted-foreground">
          We authorize the amount now and only charge you when an agent has collected your
          bags.
        </p>
      </header>

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
        <p className="text-xs text-muted-foreground">
          By booking you agree that Koolee collects your bags and delivers them to your
          airline&apos;s bag drop. You check in with your airline as usual.
        </p>
      </StepForm>
    </div>
  );
}
