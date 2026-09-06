import Link from "next/link";
import { Button, Card, CardContent } from "@koolee/ui";

/**
 * ZERO AGREEMENT VERSIONS PUBLISHED — the console's alarm for it.
 *
 * WHY THE ALARM IS HERE AND NOT ON THE CUSTOMER'S PAGE. Without a published
 * version no booking can accept anything, so `bookingHasAcceptedAgreement`
 * fails closed and EVERY agent visit is blocked at the identity step. That is
 * correct behaviour and a total outage of the pickup flow at the same time.
 *
 * The customer cannot fix it, and until now nobody was told: their trip page
 * quietly rendered nothing where the agreement step belonged, the agent's
 * screen said "the customer has not accepted our booking agreement yet" —
 * blaming someone who had no button to press — and the console said nothing
 * at all. The first symptom would have been an agent standing on a doorstep.
 *
 * So it is loud, it is on the Overview page as well as on /agreements, and it
 * names the consequence rather than the condition. A banner that said "no
 * agreement version" would be a fact; this says what it costs.
 *
 * It renders NOTHING when a version exists, so it is free on every other day.
 */
export function NoAgreementBanner({ count }: { count: number }) {
  if (count > 0) return null;

  return (
    <Card className="border-destructive">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-display text-base font-medium text-destructive">
            No agreement published — customers cannot complete check-in.
          </p>
          <p className="text-sm text-muted-foreground">
            Every agent visit is blocked at the identity step until a version is in
            effect, and there is nothing a customer can do about it from their end.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/agreements">Publish a version</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
