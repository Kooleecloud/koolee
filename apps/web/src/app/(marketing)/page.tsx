import Link from "next/link";
import type { Metadata } from "next";
import {
  AirportCard,
  CTAButton,
  CustodyTimeline,
  FAQAccordion,
  HeroRouteScene,
  Reveal,
  SealMotif,
  Section,
  SectionHeader,
  StepCard,
} from "@koolee/ui";
import { ArrowRight, CalendarCheck, Camera, MapPin, Route, UserCheck } from "lucide-react";

import { EnvStatus } from "@/components/env-status";
import { TOP_FAQS } from "@/lib/faq";

export const metadata: Metadata = {
  description:
    "Koolee picks up your bags at your door, seals them in front of you, and delivers them to your airline's bag drop at JFK, LGA, or EWR. Walk into the airport carrying nothing.",
};

const JOURNEY_STEPS = [
  {
    step: 1,
    title: "Book online",
    body: "Tell us your flight and address. We only offer pickup windows that comfortably make your airline's bag-drop cutoff.",
    visual: <CalendarCheck />,
  },
  {
    step: 2,
    title: "Verified & sealed at your door",
    body: "Your agent checks the traveler's ID against the booking, weighs each bag, and closes it with a serialized orange seal — while you watch.",
    visual: <SealMotif label={null} className="h-9" />,
  },
  {
    step: 3,
    title: "Live-tracked to the airport",
    body: "Your sealed bags ride in a tracked vehicle. Follow every mile on your trip page.",
    visual: <Route />,
  },
  {
    step: 4,
    title: "Delivered to your airline's bag drop",
    body: "We hand your sealed bags to the airline's bag-drop counter, photographed and confirmed on your timeline.",
    visual: <MapPin />,
  },
];

const CUSTODY_ITEMS = [
  {
    id: "id-check",
    title: "ID checked at your door",
    description:
      "Your agent confirms the traveler's ID against the booking before touching a single bag.",
    icon: <UserCheck />,
  },
  {
    id: "sealed",
    title: "Sealed while you watch",
    description:
      "Every bag closes with a serialized tamper-evident seal — the same orange as the button you booked with.",
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
    note: "Pickup windows are computed from your airline's JFK bag-drop cutoff.",
  },
  {
    code: "LGA",
    name: "LaGuardia",
    body: "All terminals. The quick hop — a natural fit for domestic departures.",
    note: "Pickup windows are computed from your airline's LGA bag-drop cutoff.",
  },
  {
    code: "EWR",
    name: "Newark Liberty International",
    body: "All terminals. Pickups from Manhattan and Jersey City.",
    note: "Pickup windows are computed from your airline's EWR bag-drop cutoff.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* 1 · Hero */}
      <Section space="none" className="overflow-hidden pb-16 pt-10 sm:pb-24 sm:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <Reveal stagger={0.08} className="flex flex-col items-start gap-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
              Doorstep luggage pickup · NYC
            </p>
            <h1 className="font-display text-display-lg font-semibold text-navy-800">
              Walk into the airport carrying nothing.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              Koolee picks up your bags at your door, seals them in front of you, and
              delivers them to your airline&apos;s bag drop at JFK, LGA, or EWR — timed
              to your airline&apos;s cutoff so they&apos;re always there before you are.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <CTAButton size="lg" asChild>
                <Link href="/login">Get Started</Link>
              </CTAButton>
              <CTAButton variant="ghost" size="lg" asChild>
                <Link href="/how-it-works">How it works</Link>
              </CTAButton>
            </div>
            <p className="text-sm text-muted-foreground">
              Serving Manhattan, Brooklyn, Queens, and Jersey City.
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

      {/* 2 · How it works */}
      <Section id="journey" aria-labelledby="journey-heading">
        <Reveal>
          <SectionHeader
            eyebrow="How it works"
            heading={<span id="journey-heading">Four steps. Zero carrying.</span>}
            body="From your hallway to your airline's bag-drop counter — every step visible, every step on time."
          />
        </Reveal>
        <Reveal stagger={0.1} className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* 3 · Trust / chain of custody — the centerpiece */}
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
        <Reveal className="mt-12 flex flex-col items-start gap-6 rounded-2xl bg-navy-50 p-6 sm:flex-row sm:items-center sm:p-8">
          <SealMotif className="h-20 shrink-0" />
          <div>
            <h3 className="font-display text-lg font-semibold text-navy-800">
              The orange tag means untouched.
            </h3>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Every seal is serialized and recorded on your booking. It goes on at your
              door and comes off at the airline — and the live timeline on your trip
              page speaks the same visual language you&apos;re looking at here.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* 4 · Coverage + cutoffs */}
      <Section aria-labelledby="coverage-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Coverage"
            heading={<span id="coverage-heading">Three airports, one calm morning</span>}
            body="We track bag-drop cutoffs by airline and airport, and compute your pickup window backwards from yours — so your bags always arrive with room to spare."
          />
        </Reveal>
        <Reveal stagger={0.1} className="mt-12 grid gap-5 md:grid-cols-3">
          {AIRPORTS.map((airport) => (
            <AirportCard key={airport.code} {...airport} />
          ))}
        </Reveal>
      </Section>

      {/* 5 · Pricing teaser */}
      <Section tone="raised" aria-labelledby="pricing-heading">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal className="flex flex-col items-start gap-5">
            <SectionHeader
              eyebrow="Pricing"
              heading={<span id="pricing-heading">Priced like a fare, not a favor</span>}
              body="One base fee, one per-bag rate, and the pickup window you choose. The estimate you see is computed by the same engine that prices your booking."
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
            <p className="mt-2 font-display text-display-sm font-semibold">
              $29 + $15{" "}
              <span className="text-xl font-medium text-navy-200">per bag</span>
            </p>
            <ul className="mt-6 flex flex-col gap-2.5 text-sm text-navy-100">
              <li>· Doorstep pickup, sealing, and bag-drop delivery included</li>
              <li>· Express and priority windows available</li>
              <li>· Three or more bags saves 10%</li>
              <li>· No tips, no hidden fees</li>
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* 6 · FAQ teaser */}
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

      {/* 7 · Final CTA band */}
      <Section tone="navy" aria-labelledby="cta-heading">
        <Reveal className="flex flex-col items-center gap-6 text-center">
          <h2
            id="cta-heading"
            className="font-display text-display font-semibold text-white"
          >
            Fly Hassle-Free.
          </h2>
          <p className="max-w-xl text-lg text-navy-100">
            Book your first pickup in about two minutes. Your bags meet you at the
            airline&apos;s bag drop — sealed, photographed, on time.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <CTAButton size="lg" asChild>
              <Link href="/login">Get Started</Link>
            </CTAButton>
            <CTAButton variant="ghost-inverse" size="lg" asChild>
              <Link href="/how-it-works">See how it works</Link>
            </CTAButton>
          </div>
        </Reveal>
      </Section>

      <div className="container pb-10">
        <EnvStatus appName="web" />
      </div>
    </>
  );
}
