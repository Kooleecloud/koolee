import type { Metadata } from "next";
import Link from "next/link";
import {
  CTAButton,
  PriceEstimator,
  Reveal,
  Section,
  SectionHeader,
} from "@koolee/ui";

import { estimatePrice } from "./actions";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Transparent pricing for doorstep luggage pickup delivered to your airline's bag drop: one base fee, one per-bag rate, and the pickup window you choose. Get an instant estimate.",
};

const TIERS = [
  { id: "standard_4h", label: "Standard · 4-hour window", description: "Included" },
  { id: "express_2h", label: "Express · 2-hour window", description: "+35%" },
  { id: "priority_1h", label: "Priority · 1-hour window", description: "+80%" },
];

const AIRPORTS = [
  { code: "JFK", label: "John F. Kennedy International" },
  { code: "LGA", label: "LaGuardia" },
  { code: "EWR", label: "Newark Liberty International" },
];

const PRICE_PARTS = [
  {
    title: "Base fee — $29",
    body: "Covers the visit: your agent at the door, ID verification, weighing, sealing, and the delivery hand-off at the airline's bag-drop counter.",
  },
  {
    title: "$15 per bag",
    body: "Each sealed bag adds a flat rate. No tiers by size — your airline's checked-bag rules are the only limits.",
  },
  {
    title: "Travel, by distance",
    body: "A small distance-based amount for the drive to your airport. The estimate uses a typical route; your exact address prices it precisely at booking.",
  },
  {
    title: "Your window, your call",
    body: "A relaxed 4-hour pickup window is included. Tighter 2-hour and 1-hour windows cost more because they hold a driver just for you.",
  },
];

export default function PricingPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="Pricing"
            heading="Know the price before you pack."
            body="One base fee, a flat per-bag rate, and the pickup window you choose. The estimate below runs on the same pricing engine as a real booking — you always see the full amount before you pay."
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

      <Section aria-labelledby="price-parts-heading">
        <Reveal>
          <SectionHeader
            heading={<span id="price-parts-heading">How your price is built</span>}
            body="Four parts, no fine print. Every booking shows this exact breakdown."
          />
        </Reveal>
        <Reveal stagger={0.08} className="mt-10 grid gap-5 sm:grid-cols-2">
          {PRICE_PARTS.map((part) => (
            <div
              key={part.title}
              className="rounded-2xl border border-border bg-white p-6 shadow-lift"
            >
              <h3 className="font-display text-lg font-semibold text-navy-800">
                {part.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {part.body}
              </p>
            </div>
          ))}
        </Reveal>
        <Reveal className="mt-8 rounded-2xl bg-navy-50 p-6 text-sm leading-relaxed text-navy-800">
          <p>
            <strong className="font-semibold">Our fair-play promise:</strong> if we miss
            your airline&apos;s bag-drop cutoff for a reason within our control, the
            trip is free. No tips, no hidden fees — the number you approve is the
            number you pay.
          </p>
        </Reveal>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Ready when you are.
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book/zip">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
