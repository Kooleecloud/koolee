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
  PageHeader,
} from "@koolee/ui";
import {
  formatWindowInAirportTz,
  getCustomerById,
  quoteBookingPrice,
} from "@koolee/core";

import { readDraft, nextIncompleteStep } from "@/lib/booking-draft";
import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { maskPhone } from "@/lib/phone";

export const metadata = { title: "Your price" };
export const dynamic = "force-dynamic";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function PriceStepPage() {
  const draft = await readDraft();
  if (nextIncompleteStep(draft) !== "/book/price") {
    redirect(nextIncompleteStep(draft));
  }

  const core = tryGetCore();
  if (!core) return <NoDatabase />;

  let quote;
  try {
    quote = await quoteBookingPrice(core, {
      slotId: draft.slotId!,
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

  // The ONLY auth gate in the product: "Book pickup". A verified session skips
  // it entirely; everyone else verifies a contact channel first.
  const authUser = await getAuthUser();
  const verified = authUser && !authUser.isAnonymous;
  const userRow = verified ? await getCustomerById(core.db, authUser.id).catch(() => null) : null;
  const phoneForFooter = userRow?.phone ?? authUser?.phone ?? null;
  const ctaHref = verified ? "/book/pay" : "/book/verify";

  const { breakdown, slot } = quote;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your price"
        subtitle={
          <>
            {draft.bagCount} {draft.bagCount === 1 ? "bag" : "bags"} · flight{" "}
            {draft.flightNumber} from {draft.departureAirport} · pickup{" "}
            {formatWindowInAirportTz(slot.windowStart, slot.windowEnd, "America/New_York")}
          </>
        }
      />

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
            {breakdown.tierAdjustmentCents !== 0 && (
              <>
                <dt className="text-muted-foreground">Window priority</dt>
                <dd className="text-right">{dollars(breakdown.tierAdjustmentCents)}</dd>
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

      <CTAButton asChild size="lg" className="w-full">
        <Link href={ctaHref}>Book pickup</Link>
      </CTAButton>

      {verified && phoneForFooter ? (
        <p className="text-center text-xs text-muted-foreground">
          Updates will go to {maskPhone(phoneForFooter)} —{" "}
          <Link href="/book/verify" className="underline underline-offset-4">
            change
          </Link>
        </p>
      ) : null}
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
