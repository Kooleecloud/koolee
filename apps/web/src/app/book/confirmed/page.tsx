import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

export const metadata = { title: "Booking confirmed" };
export const dynamic = "force-dynamic";

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re booked</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ve authorized your payment. You&apos;ll be charged when an agent
          collects your bags.
        </p>
      </header>

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

      <div className="flex flex-wrap gap-3">
        {booking ? (
          <Button asChild>
            <Link href={`/trips/${booking}`}>Track this booking</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </div>
  );
}
