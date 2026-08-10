import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CTAButton,
  Input,
  Label,
  PageHeader,
} from "@koolee/ui";
import {
  formatWindowInAirportTz,
  getCustomerById,
  quoteBookingPrice,
} from "@koolee/core";

import { confirmBooking } from "@/app/book/actions";
import { StepForm } from "@/components/step-form";
import { StripeCheckout } from "@/components/stripe-checkout";
import { readDraft } from "@/lib/booking-draft";
import { nextIncompleteStep, stepIsUnlocked } from "@/lib/booking-steps";
import { getAuthUser } from "@/lib/auth";
import { stripeCheckoutState, tryGetCore } from "@/lib/core";
import { maskPhone } from "@/lib/phone";

export const metadata = { title: "Review & pay" };
export const dynamic = "force-dynamic";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Step 4 — review + price + payment on one page.
 *
 * Anonymous visitors see the full review and quote with a CTA into the
 * verification gate (the price is never hidden behind the auth wall);
 * verified sessions get the payment UI inline. The hard gates stay in the
 * server actions (`confirmBooking`, `preparePayment`) — this page only
 * decides what to render.
 */
export default async function PayStepPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment: paymentFlag } = await searchParams;
  const draft = await readDraft();
  if (!stepIsUnlocked(draft, "/book/pay")) {
    redirect(nextIncompleteStep(draft));
  }

  const core = tryGetCore();
  if (!core) return <NoDatabase />;

  let quote;
  try {
    quote = await quoteBookingPrice(core, {
      pickupWindowEnd: new Date(draft.windowEnd!),
      departureAt: new Date(draft.departureAt!),
      bagCount: draft.bagCount!,
      // TODO(maps): real door-to-airport distance via the Maps API.
      distanceKm: 20,
      promoCode: draft.promoCode ?? null,
    });
  } catch (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">We couldn&apos;t price that window</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "Pick another pickup window."}{" "}
            <Link href="/book/slot" className="underline underline-offset-4">
              Back to pickup windows
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const authUser = await getAuthUser();
  const verified = Boolean(authUser && !authUser.isAnonymous);
  const userRow =
    verified && authUser ? await getCustomerById(core.db, authUser.id).catch(() => null) : null;
  const verifiedPhone = userRow?.phone ?? authUser?.phone ?? null;
  // Email-only customers: the driver still needs a number for pickup day.
  const needsContactPhone = verified && !verifiedPhone;

  const { breakdown } = quote;
  const pickupWindow = formatWindowInAirportTz(
    new Date(draft.windowStart!),
    new Date(draft.windowEnd!),
    "America/New_York",
  );

  const checkoutState = stripeCheckoutState();
  const stripeReady = checkoutState === "ready";

  const edit = (href: string) => (
    <Link
      href={href}
      className="ml-2 text-xs text-muted-foreground underline underline-offset-4"
    >
      Edit
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Review & pay"
        subtitle="Check everything once — we authorize the amount now and only charge you when an agent has collected your bags."
      />

      {(paymentFlag === "failed" || paymentFlag === "incomplete") && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">
              {paymentFlag === "failed"
                ? "That payment didn't go through"
                : "Your payment wasn't completed"}
            </CardTitle>
            <CardDescription>
              You have not been charged. Your booking details are saved — try again
              below, or use a different card.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your booking</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Flight</dt>
            <dd>
              {draft.flightNumber} from {draft.departureAirport}
              {edit("/book/flight")}
            </dd>
            <dt className="text-muted-foreground">Passenger</dt>
            <dd>{draft.paxName}</dd>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd>
              {draft.line1}
              {draft.line2 ? `, ${draft.line2}` : ""}, {draft.city} {draft.state}{" "}
              {draft.zip}
              {edit("/book/pickup")}
            </dd>
            <dt className="text-muted-foreground">Bags</dt>
            <dd>
              {draft.bagCount}
              {edit("/book/pickup")}
            </dd>
            <dt className="text-muted-foreground">Window</dt>
            <dd>
              {pickupWindow}
              {edit("/book/slot")}
            </dd>
            {verified && verifiedPhone && (
              <>
                <dt className="text-muted-foreground">Updates</dt>
                <dd>
                  Texts to {maskPhone(verifiedPhone)} —{" "}
                  <Link href="/book/verify" className="underline underline-offset-4">
                    change
                  </Link>
                </dd>
              </>
            )}
            {verified && !verifiedPhone && (
              <>
                <dt className="text-muted-foreground">Updates</dt>
                <dd>Email to {userRow?.email ?? authUser?.email}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between text-base">
            <span>Total, all-in</span>
            <span
              data-testid="price-total"
              className="font-display text-3xl font-semibold text-navy-800"
            >
              {dollars(breakdown.totalCents)}
            </span>
          </CardTitle>
          <CardDescription>
            About the price of an UberXL to JFK — without carrying a single bag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Base fee</dt>
            <dd className="text-right">{dollars(breakdown.baseFeeCents)}</dd>
            <dt className="text-muted-foreground">
              {draft.bagCount} {draft.bagCount === 1 ? "bag" : "bags"}
            </dt>
            <dd className="text-right">{dollars(breakdown.bagsCents)}</dd>
            <dt className="text-muted-foreground">Distance</dt>
            <dd className="text-right">{dollars(breakdown.distanceCents)}</dd>
            {breakdown.leadTimeAdjustmentCents !== 0 && (
              <>
                <dt className="text-muted-foreground">Pickup timing</dt>
                <dd className="text-right">
                  {dollars(breakdown.leadTimeAdjustmentCents)}
                </dd>
              </>
            )}
            {breakdown.discounts.map((discount) => (
              <Fragment key={discount.label}>
                <dt className="text-muted-foreground">{discount.label}</dt>
                <dd className="text-right text-success">
                  −{dollars(discount.amountCents)}
                </dd>
              </Fragment>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Authorized now, charged only when an agent has collected and sealed your
            bags. Delivered to your airline&apos;s bag drop.
          </p>
        </CardContent>
      </Card>

      {!verified ? (
        // The ONLY auth gate in the product sits behind this button — the
        // price is always visible before we ask anyone to verify.
        <>
          <CTAButton asChild size="lg" className="w-full">
            <Link href="/book/verify">Book pickup</Link>
          </CTAButton>
          <p className="text-center text-xs text-muted-foreground">
            Next: verify a phone or email for pickup updates — about 30 seconds.
          </p>
        </>
      ) : stripeReady ? (
        // Card collection + authorize + terms live inside the checkout card;
        // confirmation always routes through /book/return's server-side
        // status re-check.
        <StripeCheckout needsContactPhone={needsContactPhone} />
      ) : checkoutState === "misconfigured" ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Payment is misconfigured</CardTitle>
            <CardDescription>
              <code>STRIPE_SECRET_KEY</code> is set but{" "}
              <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> is not, so the browser
              could never confirm a card. Set both keys for real checkout, or unset the
              secret key to use the development provider. No bookings can be taken
              until this is fixed.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Development payment</CardTitle>
              <CardDescription>
                No Stripe keys are configured, so this booking uses{" "}
                <code>FakePaymentProvider</code>. No card is collected and no money
                moves. Set <code>STRIPE_SECRET_KEY</code> and{" "}
                <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to switch to real
                Stripe Elements.
              </CardDescription>
            </CardHeader>
          </Card>

          <StepForm action={confirmBooking} submitLabel="Book with test payment">
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
              By booking you agree that Koolee collects your bags and delivers them to
              your airline&apos;s bag drop. You check in with your airline as usual.
            </p>
          </StepForm>
        </>
      )}
    </div>
  );
}

function NoDatabase() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Database not configured</CardTitle>
        <CardDescription>
          Set <code>DATABASE_URL</code> in <code>.env.local</code>, then run{" "}
          <code>pnpm db:migrate &amp;&amp; pnpm seed</code>. See the README quickstart.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
