import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CTAButton,
  PageHeader,
} from "@koolee/ui";
import { getCustomerById } from "@koolee/core";

import { ConfirmationEmailCard } from "@/components/confirmation-email-card";
import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "Booking confirmed" };
export const dynamic = "force-dynamic";

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;

  // Show the email block only when the account has no email yet.
  const authUser = await getAuthUser();
  const core = tryGetCore();
  const userRow =
    authUser && core ? await getCustomerById(core.db, authUser.id).catch(() => null) : null;
  const hasEmail = Boolean(userRow?.email ?? authUser?.email);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={<>You&apos;re booked</>}
        subtitle={
          <>
            We&apos;ve authorized your payment. You&apos;ll be charged when an agent
            collects your bags.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happens next</CardTitle>
          <CardDescription>
            You&apos;ll get an SMS two hours before your pickup window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3 text-sm">
            <li>
              <span className="font-medium">1. We verify and seal.</span>{" "}
              <span className="text-muted-foreground">
                An agent checks your ID against the booking, weighs each bag, seals it,
                and photographs it.
              </span>
            </li>
            <li>
              <span className="font-medium">2. A driver collects.</span>{" "}
              <span className="text-muted-foreground">
                You can follow every handover on your trip page.
              </span>
            </li>
            <li>
              <span className="font-medium">
                3. Delivered to your airline&apos;s bag drop.
              </span>{" "}
              <span className="text-muted-foreground">
                You check in with your airline as usual.
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>

      {!hasEmail && booking ? <ConfirmationEmailCard bookingId={booking} /> : null}

      <div className="flex flex-wrap gap-3">
        {booking ? (
          <CTAButton asChild>
            <Link href={`/trips/${booking}`}>Track my pickup</Link>
          </CTAButton>
        ) : null}
        {/* h-11/px-6 matches the CTAButton beside it (Button defaults to h-9). */}
        <Button asChild variant="ghost" className="h-11 px-6">
          <Link href="/dashboard/profile">Complete my profile</Link>
        </Button>
      </div>
    </div>
  );
}
