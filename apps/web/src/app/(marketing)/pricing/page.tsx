import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton, PriceEstimator, Reveal, Section, SectionHeader } from "@koolee/ui";

import { estimatePrice } from "./actions";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Transparent pricing for doorstep luggage pickup delivered to your airline's bag drop: one base fee, one per-bag rate, and the pickup window you choose. Get an instant estimate.",
};

const TIERS = [
  { id: "lead_24h_plus", label: "24+ hours before departure", description: "Included" },
  { id: "lead_16_24h", label: "16–24 hours before", description: "+10%" },
  { id: "lead_10_16h", label: "10–16 hours before", description: "+20%" },
  { id: "lead_6_10h", label: "6–10 hours before", description: "+40%" },
];

const AIRPORTS = [
  { code: "JFK", label: "John F. Kennedy International" },
  { code: "LGA", label: "LaGuardia" },
  { code: "EWR", label: "Newark Liberty International" },
];

/**
 * The four-card "How your price is built" breakdown is gone. Every booking
 * already itemises the same lines before payment, and the estimator prints
 * them live — restating the formula in prose on the marketing page added
 * reading without adding trust. What survives is the promise, which is the
 * part a visitor cannot get from the widget.
 */
export default function PricingPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="Pricing"
            heading="Know the price before you pack."
            body="One base fee, a flat per-bag rate, and the pickup window you choose. You always see the full amount before you pay."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-label="Price estimate">
        <Reveal>
          <PriceEstimator
            estimate={estimatePrice}
            tiers={TIERS}
            airports={AIRPORTS}
            disclaimer="Estimate uses a typical drive distance to your airport. Your exact price is computed from your pickup address at booking — shown in full before payment. Three or more bags saves 10% automatically."
          />
        </Reveal>
      </Section>

      <Section aria-labelledby="fair-play-heading">
        <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl bg-navy-50 p-8 sm:p-10">
          <p className="text-sm font-semibold tracking-[0.18em] text-sky-600 uppercase">
            Our fair-play promise
          </p>
          <h2
            id="fair-play-heading"
            className="font-display text-display-sm font-semibold text-navy-800"
          >
            If we miss your airline&apos;s bag-drop cutoff for a reason within our
            control, the trip is free.
          </h2>
          <p className="text-lg leading-relaxed text-muted-foreground">
            No tips, no hidden fees — the number you approve is the number you pay.
          </p>
        </Reveal>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Ready when you are.
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
