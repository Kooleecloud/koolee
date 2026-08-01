import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, KooleeLogo } from "@koolee/ui";

import { EnvStatus } from "@/components/env-status";

/**
 * Placeholder marketing copy.
 *
 * Copy rule (see root README): Koolee delivers bags to the airline's bag drop.
 * Never claim we check anyone in, hand bags to TSA, or load aircraft. No
 * fabricated stats.
 */
const STEPS = [
  {
    title: "Book your pickup",
    body: "Tell us your flight and address. We only show pickup windows that still make your airline's bag-drop cutoff.",
  },
  {
    title: "We verify and seal",
    body: "A Koolee agent checks the traveller's ID against the booking, weighs each bag, seals it, and photographs it.",
  },
  {
    title: "Delivered to your airline's bag drop",
    body: "A driver takes your sealed bags to the airport and delivers them to your airline's bag drop. You check in as usual.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="container flex max-w-5xl flex-col gap-10 py-14">
      <header className="flex flex-col gap-5">
        <KooleeLogo />
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Doorstep luggage pickup, delivered to your airline&apos;s bag drop.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Serving JFK, LGA, and EWR. We collect your bags at your door and deliver them to
          your airline&apos;s bag drop at the airport.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/book/flight">Book a pickup</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/trips">My trips</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-base">
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {step.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {step.body}
            </CardContent>
          </Card>
        ))}
      </section>

      <EnvStatus appName="web" />
    </main>
  );
}
