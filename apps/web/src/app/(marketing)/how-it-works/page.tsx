import type { Metadata } from "next";
import Link from "next/link";
import {
  CTAButton,
  CustodyTimeline,
  JourneyGlyph,
  Reveal,
  Section,
  SectionHeader,
  type CustodyTimelineItem,
  type JourneyGlyphName,
} from "@koolee/ui";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The Koolee journey in four steps: book online, your agent verifies, weighs and seals your bags at the door, follow the live tracking, and your bags are delivered to your airline's bag drop.",
};

/**
 * One line per step, and no more.
 *
 * The previous version explained the cutoff arithmetic behind a pickup window
 * and listed a "you get:" outcome under every step. Both went: a traveller does
 * not need our method to trust the result, and a competitor should not be
 * handed it. The step titles match the homepage exactly — this page is the same
 * four beats with one sentence each, not a second, longer story.
 */
const STEPS: {
  number: number;
  title: string;
  glyph: JourneyGlyphName;
  body: string;
}[] = [
  {
    number: 1,
    title: "Book a Koolee online",
    glyph: "book",
    body: "Your flight, your address, and the pickup window you want.",
  },
  {
    number: 2,
    title: "Agent arrives, verifies, weighs and seals your bags",
    glyph: "seal",
    body: "Your Koolee agent arrives in the window you chose.",
  },
  {
    number: 3,
    title: "Live tracking",
    glyph: "track",
    body: "Follow your bags from your doorstep to the terminal.",
  },
  {
    number: 4,
    title: "Delivered to your airline",
    glyph: "deliver",
    body: "Handed to your airline's bag drop and photographed. You check in as usual.",
  },
];

const SAMPLE_TIMELINE: CustodyTimelineItem[] = [
  {
    id: "booked",
    title: "Booking confirmed",
    meta: "Tue 9:12 AM",
    state: "complete",
  },
  {
    id: "sealed",
    title: "Bags verified & sealed at your door",
    description: "2 bags · seals NYC 000481, NYC 000482 · photos attached",
    meta: "Tue 10:05 AM",
    state: "complete",
  },
  {
    id: "in-transit",
    title: "On the way to JFK",
    description: "Live-tracked vehicle",
    meta: "Tue 10:22 AM",
    state: "current",
  },
  {
    id: "delivered",
    title: "Delivered to your airline's bag drop",
    state: "upcoming",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="How it works"
            heading="From your hallway to the bag drop, in plain sight."
            body="Four steps, each one visible on your trip page as it happens."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-label="The four steps">
        {/*
          One layout for all four cards. The previous version alternated sides
          with `order-last`, which moved the children but not the 1fr/1.6fr
          columns — so steps 2 and 4 put the narrow column on the right and the
          text into it, and only steps 1 and 3 ran the full width. A fixed-width
          number rail plus a 1fr body column makes every card identical.
        */}
        <ol className="flex flex-col gap-4">
          {STEPS.map((step) => (
            <li key={step.number}>
              <Reveal
                delay={0.05}
                className="grid items-center gap-5 rounded-2xl border border-border bg-white p-6 shadow-lift sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-7"
              >
                {/* Number and glyph sit side by side at every width. Stacking
                    them made the rail twice as tall as the two lines of copy
                    beside it, and the card inherited that height as blank
                    space — the exact complaint the copy review opened with. */}
                <div className="flex items-center gap-4 sm:w-44">
                  <span
                    aria-hidden="true"
                    className="font-display text-5xl leading-none font-semibold text-navy-100"
                  >
                    {String(step.number).padStart(2, "0")}
                  </span>
                  <div className="rounded-2xl bg-navy-50 p-3.5">
                    <JourneyGlyph name={step.glyph} className="h-11" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <h2 className="font-display text-display-sm font-semibold text-navy-800">
                    <span className="sr-only">Step {step.number}: </span>
                    {step.title}
                  </h2>
                  <p className="text-lg leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="raised" aria-labelledby="sample-timeline-heading">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <Reveal>
            <SectionHeader
              eyebrow="Your trip page"
              heading={<span id="sample-timeline-heading">Watch it happen, live</span>}
              body="The same timeline you saw on the home page — filled in with your bags, your seals, your timestamps."
            />
          </Reveal>
          <Reveal className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <p className="mb-5 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Example trip
            </p>
            <CustodyTimeline items={SAMPLE_TIMELINE} />
          </Reveal>
        </div>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Your next trip starts empty-handed.
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <CTAButton size="lg" asChild>
              <Link href="/book">Book a pickup</Link>
            </CTAButton>
            <CTAButton variant="ghost-inverse" size="lg" asChild>
              <Link href="/pricing">See pricing</Link>
            </CTAButton>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
