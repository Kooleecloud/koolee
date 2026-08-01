"use client";

import { useMemo } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@koolee/ui";

/**
 * Stripe Elements mount point.
 *
 * `loadStripe` is called lazily inside a memo rather than at module scope: at
 * module scope it would fire on every page that imports this file, including
 * ones with no payment on them.
 *
 * TODO(payments): this renders the Elements provider but not a PaymentElement.
 * Doing that properly needs a client secret, which needs a PaymentIntent, which
 * `createBooking` only creates once the slot has been claimed. The real flow is:
 *
 *   1. POST to a route handler that runs `createBooking` and returns
 *      `payment.clientSecret` with the booking left in `draft`;
 *   2. mount <PaymentElement /> against that secret and confirm in the browser;
 *   3. let the `payment_intent.amount_capturable_updated` webhook move the
 *      booking to `paid` (already implemented in core's webhook handler).
 *
 * Until then the dev path uses FakePaymentProvider, which is what runs whenever
 * no Stripe keys are set.
 */
export function StripeCheckoutPlaceholder() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  if (!stripePromise) return null;

  return (
    <Elements stripe={stripePromise}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Card details</CardTitle>
          <CardDescription>
            Stripe is configured. Card collection is wired up to the point of mounting
            Elements — see the TODO in <code>components/stripe-checkout.tsx</code> for the
            remaining steps. Your card is authorized now and charged at pickup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            PaymentElement mounts here once a client secret is available.
          </div>
        </CardContent>
      </Card>
    </Elements>
  );
}
