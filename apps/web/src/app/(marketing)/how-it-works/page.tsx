import type { Metadata } from "next";
import Link from "next/link";
import {
  CTAButton,
  CustodyTimeline,
  Reveal,
  SealMotif,
  Section,
  SectionHeader,
  type CustodyTimelineItem,
} from "@koolee/ui";
import { CalendarCheck, MapPin, Route } from "lucide-react";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The Koolee journey in four steps: book online, get verified and sealed at your door, follow the live-tracked ride, and we deliver your bags to your airline's bag drop.",
};

const STEPS = [
  {
    number: 1,
    title: "Book online",
    visual: <CalendarCheck aria-hidden="true" className="size-10 text-sky-600" />,
    body: "Enter your flight and pickup address. We look up your airline's bag-drop cutoff at your airport, subtract the drive and a safety buffer, and offer only pickup windows that comfortably fit. Pick your window, see the full price, pay online.",
    detail: "You get: instant confirmation with your pickup window and your agent's details before arrival.",
  },
  {
    number: 2,
    title: "Verified & sealed at your door",
    visual: <SealMotif label={null} className="h-12" />,
    body: "Your Koolee agent arrives in the window you chose. First: ID — the traveler's identity is checked against the booking before anything else happens. Then each bag is weighed and closed with a serialized, tamper-evident orange seal, photographed, and logged. All of it happens in front of you.",
    detail: "You get: each seal's serial number and pickup photos on your trip page, before the agent leaves your doorstep.",
  },
  {
    number: 3,
    title: "Live-tracked to the airport",
    visual: <Route aria-hidden="true" className="size-10 text-sky-600" />,
    body: "Your sealed bags travel in a tracked vehicle, and every hand-off along the way is photographed and timestamped. Open your trip page any time — the timeline updates as your bags move.",
    detail: "You get: a live timeline from your door to the terminal, with a countdown to your airline's cutoff.",
  },
  {
    number: 4,
    title: "Delivered to your airline's bag drop",
    visual: <MapPin aria-hidden="true" className="size-10 text-sky-600" />,
    body: "We hand your sealed bags to your airline's bag-drop counter ahead of the cutoff, and photograph the delivery. From there, your bags follow the airline's normal checked-baggage process — exactly as if you'd carried them to the counter yourself. You check in as usual and walk to security carrying nothing.",
    detail: "You get: delivery confirmation with photo, and your timeline closes out with every hand-off accounted for.",
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
            body="Four steps, each one visible on your trip page as it happens. Here's the whole journey, in the order your bags experience it."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-label="The four steps">
        <ol className="flex flex-col gap-6">
          {STEPS.map((step, index) => (
            <li key={step.number}>
              <Reveal
                delay={0.05}
                className={`grid items-center gap-8 rounded-2xl border border-border bg-white p-8 shadow-lift sm:p-10 lg:grid-cols-[1fr_1.6fr] ${
                  index % 2 === 1 ? "lg:[&>*:first-child]:order-last" : ""
                }`}
              >
                <div className="flex items-center gap-6 lg:flex-col lg:items-start">
                  <span
                    aria-hidden="true"
                    className="font-display text-7xl font-semibold leading-none text-navy-100"
                  >
                    {String(step.number).padStart(2, "0")}
                  </span>
                  <div className="rounded-2xl bg-navy-50 p-5">{step.visual}</div>
                </div>
                <div className="flex flex-col gap-3">
                  <h2 className="font-display text-display-sm font-semibold text-navy-800">
                    <span className="sr-only">Step {step.number}: </span>
                    {step.title}
                  </h2>
                  <p className="leading-relaxed text-muted-foreground">{step.body}</p>
                  <p className="mt-1 border-l-2 border-sky-400 pl-4 text-sm font-medium text-navy-700">
                    {step.detail}
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
              heading={
                <span id="sample-timeline-heading">Watch it happen, live</span>
              }
              body="This is the timeline every Koolee trip produces — the same chain-of-custody view you saw on our landing page, filled in with your bags, your seals, your timestamps."
            />
          </Reveal>
          <Reveal className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
              <Link href="/login">Get Started</Link>
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
