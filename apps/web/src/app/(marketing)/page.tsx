import Link from "next/link";
import type { Metadata } from "next";
import {
  AirportCard,
  CTAButton,
  CustodyTimeline,
  FAQAccordion,
  HeroRouteScene,
  JourneyGlyph,
  Reveal,
  SealMotif,
  Section,
  SectionHeader,
  StepCard,
  TripContrast,
} from "@koolee/ui";
import { ArrowRight, Camera, MapPin, UserCheck } from "lucide-react";

import { TOP_FAQS } from "@/lib/faq";

export const metadata: Metadata = {
  description:
    "Off-airport luggage pickup in NYC. From your doorstep to your airline's bag drop at JFK, LGA, or EWR — so you walk into the airport carrying nothing.",
};

/**
 * The four steps carry a title and a glyph, nothing else.
 *
 * That is deliberate: the explanatory paragraphs that used to sit here told
 * the reader how we compute a pickup window, which is both more than a
 * traveller needs and more than a competitor is owed. The dedicated
 * /how-it-works page adds one line each; this page states the shape.
 */
const JOURNEY_STEPS = [
  { step: 1, title: "Book a Koolee online", visual: <JourneyGlyph name="book" /> },
  {
    step: 2,
    // Trimmed to two lines: on a quarter-width card the longer phrasing wrapped
    // to three and every sibling card grew a void to match. The glyph says
    // "bags"; the words carry the four actions.
    title: "Agent arrives, verifies, weighs and seals",
    visual: <JourneyGlyph name="seal" />,
  },
  { step: 3, title: "Live tracking", visual: <JourneyGlyph name="track" /> },
  {
    step: 4,
    title: "Delivered to your airline",
    visual: <JourneyGlyph name="deliver" />,
  },
];

/**
 * No invented numbers on either side of this — nothing here is measured, and a
 * fabricated "20 minutes in line" would break the repo's copy rules. The
 * contrast has to come from the sentences.
 */
const TRIP_BEFORE = [
  "Wrestle every bag down the stairs and into a car.",
  "Pay for the bigger car, because the bags will not fit in the small one.",
  "Queue at the bag drop with all of it in tow.",
  "Reach security already worn out.",
];

const TRIP_AFTER = [
  "Open the door. Your Koolee agent takes it from there.",
  "Get to the airport however you like — subway, bus, or a normal car.",
  "Walk past the bag-drop line.",
  "Reach security carrying your boarding pass.",
];

const CUSTODY_ITEMS = [
  {
    id: "id-check",
    title: "ID checked at your door",
    description:
      "Your agent confirms the traveler's ID against the booking before touching a bag.",
    icon: <UserCheck />,
  },
  {
    id: "sealed",
    title: "Sealed while you watch",
    description:
      "Weighed and secured with a tamper-evident seal, carrying a unique serial code.",
    icon: <SealMotif label={null} className="h-7" />,
  },
  {
    id: "photo-proof",
    title: "Photographed at every hand-off",
    description:
      "Door, vehicle, airport — each transfer is logged with a photo and a timestamp.",
    icon: <Camera />,
  },
  {
    id: "tracked",
    title: "Tracked to the bag drop",
    description:
      "Watch the live timeline until your bags reach your airline's bag-drop counter.",
    icon: <MapPin />,
  },
];

const AIRPORTS = [
  {
    code: "JFK",
    name: "John F. Kennedy International",
    body: "All terminals. Pickups from Manhattan, Brooklyn, and Queens.",
  },
  {
    code: "LGA",
    name: "LaGuardia",
    body: "All terminals. The quick hop — a natural fit for domestic departures.",
  },
  {
    code: "EWR",
    name: "Newark Liberty International",
    body: "All terminals. Pickups from all five boroughs and Hudson County, NJ.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* 1 · Hero */}
      <Section space="none" className="overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <Reveal stagger={0.08} className="flex flex-col items-start gap-6">
            <p className="text-sm font-semibold tracking-[0.18em] text-sky-600 uppercase">
              Off-airport luggage pickup · NYC
            </p>
            <h1 className="font-display text-display-lg font-semibold text-navy-800">
              Walk into the airport carrying nothing.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              From your doorstep to your airline&apos;s bag drop, we handle every bag —
              so you skip the haul, skip the bag-drop line, and arrive at the airport
              hassle-free.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <CTAButton size="lg" asChild>
                <Link href="/book">Book a pickup</Link>
              </CTAButton>
              <CTAButton variant="ghost" size="lg" asChild>
                <Link href="/how-it-works">How it works</Link>
              </CTAButton>
            </div>
            <p className="text-sm text-muted-foreground">
              Serving all five NYC boroughs, plus Jersey City and Hoboken.
            </p>
          </Reveal>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(closest-side,#D9F1FA_0%,transparent_75%)] opacity-70"
            />
            <HeroRouteScene />
          </div>
        </div>
      </Section>

      {/* 2 · What changes — the answer to "why do I want this?" */}
      <Section tone="raised" aria-labelledby="changes-heading">
        <Reveal>
          <SectionHeader
            eyebrow="What changes"
            heading={<span id="changes-heading">No hauling. No bag-drop line.</span>}
            body="The trip to the airport is the part nobody books a ticket for. Koolee takes it off your itinerary."
          />
        </Reveal>
        <Reveal className="mt-10">
          <TripContrast
            before={{ label: "Getting to the airport today", items: TRIP_BEFORE }}
            after={{ label: "Getting to the airport with Koolee", items: TRIP_AFTER }}
          />
        </Reveal>
      </Section>

      {/* 3 · How it works */}
      <Section id="journey" aria-labelledby="journey-heading">
        <Reveal>
          <SectionHeader
            eyebrow="How it works"
            heading={<span id="journey-heading">Four steps. Zero carrying.</span>}
          />
        </Reveal>
        <Reveal stagger={0.1} className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {JOURNEY_STEPS.map((step) => (
            <StepCard key={step.step} {...step} />
          ))}
        </Reveal>
        <Reveal className="mt-8">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 underline-offset-4 hover:text-sky-600 hover:underline"
          >
            See the full journey <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Reveal>
      </Section>

      {/* 4 · Trust / chain of custody — the centerpiece */}
      <Section tone="raised" aria-labelledby="custody-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Chain of custody"
            heading={<span id="custody-heading">How we protect your bags</span>}
            body="Trusting someone with your luggage shouldn't take a leap of faith. It should take evidence. Every Koolee trip produces its own."
          />
        </Reveal>
        <Reveal className="mt-12">
          <CustodyTimeline orientation="horizontal" items={CUSTODY_ITEMS} />
        </Reveal>
      </Section>

      {/* 5 · Coverage */}
      <Section aria-labelledby="coverage-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Coverage"
            heading={
              <span id="coverage-heading">Three airports, one easy departure.</span>
            }
          />
        </Reveal>
        <Reveal stagger={0.1} className="mt-10 grid gap-5 md:grid-cols-3">
          {AIRPORTS.map((airport) => (
            <AirportCard key={airport.code} {...airport} />
          ))}
        </Reveal>
      </Section>

      {/* 6 · Pricing teaser */}
      <Section tone="raised" aria-labelledby="pricing-heading">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal className="flex flex-col items-start gap-5">
            <SectionHeader
              eyebrow="Pricing"
              heading={<span id="pricing-heading">Priced like a fare, not a favor</span>}
              body="The number you approve is the number you pay."
            />
            <CTAButton variant="ghost" asChild>
              <Link href="/pricing">
                See pricing &amp; get an estimate{" "}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </CTAButton>
          </Reveal>
          <Reveal className="rounded-2xl border border-border bg-navy-800 p-8 text-white shadow-lift">
            <p className="text-sm font-medium text-navy-200">Launch pricing</p>
            <p className="font-display text-display-sm mt-2 font-semibold">
              $29 + $15{" "}
              <span className="text-xl font-medium text-navy-200">per bag</span>
            </p>
            <ul className="mt-6 flex flex-col gap-2.5 text-sm text-navy-100">
              <li>· Doorstep pickup, sealing, and bag-drop delivery included</li>
              <li>· Three or more bags saves 10%</li>
              <li>· No tips, no hidden fees</li>
            </ul>
            <p className="mt-6 border-t border-white/15 pt-5 text-sm leading-relaxed text-navy-200">
              Miss your airline&apos;s bag-drop cutoff for a reason within our control?
              The trip is free.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* 7 · FAQ teaser */}
      <Section aria-labelledby="faq-heading">
        <Reveal>
          <SectionHeader
            align="center"
            eyebrow="Questions"
            heading={<span id="faq-heading">Asked before every first booking</span>}
          />
        </Reveal>
        <Reveal className="mx-auto mt-10 max-w-2xl">
          <FAQAccordion items={TOP_FAQS} />
          <p className="mt-8 text-center">
            <Link
              href="/faq"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 underline-offset-4 hover:text-sky-600 hover:underline"
            >
              All questions, answered{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </p>
        </Reveal>
      </Section>

      {/* 8 · Final CTA band */}
      <Section tone="navy" aria-labelledby="cta-heading">
        <Reveal className="flex flex-col items-center gap-6 text-center">
          <h2
            id="cta-heading"
            className="font-display text-display font-semibold text-white"
          >
            Fly hassle-free.
          </h2>
          <p className="text-lg text-navy-100">Book your first pickup now.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <CTAButton size="lg" asChild>
              <Link href="/book">Book a pickup</Link>
            </CTAButton>
            <CTAButton variant="ghost-inverse" size="lg" asChild>
              <Link href="/how-it-works">See how it works</Link>
            </CTAButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
