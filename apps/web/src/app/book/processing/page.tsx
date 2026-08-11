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

/**
 * Landing spot for a payment whose confirmation is still settling (Stripe's
 * `processing` state), or one whose status could not be checked just now.
 *
 * Deliberately makes no claim about the outcome: the "Check again" affordance
 * re-runs /book/return's server-side re-check, which is the only authority.
 * The draft cookie is untouched, so a failure outcome can still retry the pay
 * step with everything intact.
 */

export const metadata = { title: "Confirming your payment" };
export const dynamic = "force-dynamic";

export default async function ProcessingPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  if (!booking) redirect("/book/pay");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Confirming your payment"
        subtitle="Your bank is still confirming the authorization. This usually takes a moment."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nothing else to do right now</CardTitle>
          <CardDescription>
            We&apos;ll only ever charge you once an agent has collected and sealed your
            bags. If the authorization doesn&apos;t go through, you can try again — your
            booking details are saved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CTAButton asChild size="lg">
            <Link href={`/book/return?booking=${booking}`}>Check again</Link>
          </CTAButton>
        </CardContent>
      </Card>
    </div>
  );
}
