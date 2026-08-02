import type { Metadata } from "next";
import Link from "next/link";
import {
  AirportCard,
  CTAButton,
  Reveal,
  Section,
  SectionHeader,
} from "@koolee/ui";
import { Clock, MapPin, Timer } from "lucide-react";

export const metadata: Metadata = {
  title: "Airports & coverage",
  description:
    "Koolee delivers sealed bags to your airline's bag drop at JFK, LaGuardia, and Newark, with doorstep pickups across Manhattan, parts of Brooklyn and Queens, and Jersey City.",
};

const AIRPORTS = [
  {
    code: "JFK",
    name: "John F. Kennedy International",
    body: "All terminals, all airlines with a bag-drop counter. The long haul out to Queens is exactly the trip you'll be glad to skip with luggage in tow.",
    note: "Your pickup window is computed from your airline's JFK bag-drop cutoff — international cutoffs are typically earlier, and we plan for yours specifically.",
  },
  {
    code: "LGA",
    name: "LaGuardia",
    body: "All terminals. Close to the city but famously awkward to reach by transit with bags — we take that part off your hands.",
    note: "Your pickup window is computed from your airline's LGA bag-drop cutoff.",
  },
  {
    code: "EWR",
    name: "Newark Liberty International",
    body: "All terminals. Cross-Hudson with luggage is nobody's favorite leg — pickups from Manhattan and Jersey City cover it.",
    note: "Your pickup window is computed from your airline's EWR bag-drop cutoff.",
  },
];

const CUTOFF_STEPS = [
  {
    icon: <Clock aria-hidden="true" className="size-6 text-sky-600" />,
    title: "We start at your cutoff",
    body: "Every airline sets a bag-drop cutoff per airport — the moment its counter stops accepting checked bags. We keep track of these so you don't have to.",
  },
  {
    icon: <Timer aria-hidden="true" className="size-6 text-sky-600" />,
    title: "We plan backwards",
    body: "From your cutoff we subtract the drive to your airport and a safety buffer. What's left is the latest your pickup can start.",
  },
  {
    icon: <MapPin aria-hidden="true" className="size-6 text-sky-600" />,
    title: "You only see windows that work",
    body: "The booking flow simply never offers a pickup window that would cut it close. If a window is on your screen, your bags make the counter with room to spare.",
  },
];

const COVERAGE_AREAS = [
  { area: "Manhattan", detail: "All neighborhoods" },
  { area: "Brooklyn", detail: "Most neighborhoods — enter your ZIP to confirm" },
  { area: "Queens", detail: "Most neighborhoods — enter your ZIP to confirm" },
  { area: "Jersey City", detail: "All neighborhoods" },
];

export default function AirportsPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="Coverage"
            heading="Three airports. One less thing to carry."
            body="We deliver sealed bags to the airline bag-drop counters at JFK, LaGuardia, and Newark, with doorstep pickups across the neighborhoods below."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-label="Airports we serve">
        <Reveal stagger={0.1} className="grid gap-5 md:grid-cols-3">
          {AIRPORTS.map((airport) => (
            <AirportCard key={airport.code} {...airport} />
          ))}
        </Reveal>
      </Section>

      <Section tone="raised" aria-labelledby="cutoff-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Cutoffs, explained"
            heading={<span id="cutoff-heading">Why your bags are never late</span>}
            body="The pickup window we offer you isn't a guess — it's arithmetic, done backwards from your airline's own deadline."
          />
        </Reveal>
        <Reveal stagger={0.1} className="mt-10 grid gap-5 md:grid-cols-3">
          {CUTOFF_STEPS.map((step) => (
            <div
              key={step.title}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-6 shadow-lift"
            >
              <div className="w-fit rounded-xl bg-sky-50 p-3">{step.icon}</div>
              <h3 className="font-display text-lg font-semibold text-navy-800">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </Reveal>
      </Section>

      <Section aria-labelledby="service-area-heading">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <Reveal className="flex flex-col items-start gap-6">
            <SectionHeader
              eyebrow="Pickup area"
              heading={<span id="service-area-heading">Where we knock</span>}
              body="Enter your ZIP in the booking flow and we'll confirm instantly. Outside the area? Join the waitlist and we'll email you the day your neighborhood opens."
            />
            <ul className="flex w-full max-w-md flex-col divide-y divide-border rounded-2xl border border-border bg-white shadow-lift">
              {COVERAGE_AREAS.map((item) => (
                <li
                  key={item.area}
                  className="flex items-baseline justify-between gap-4 px-5 py-4"
                >
                  <span className="font-medium text-navy-800">{item.area}</span>
                  <span className="text-right text-sm text-muted-foreground">
                    {item.detail}
                  </span>
                </li>
              ))}
            </ul>
            <CTAButton variant="ghost" asChild>
              <Link href="/waitlist">Not covered yet? Join the waitlist</Link>
            </CTAButton>
          </Reveal>

          <Reveal className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-navy-200 bg-navy-50 p-10 text-center lg:min-h-96">
            <MapPin aria-hidden="true" className="size-8 text-navy-300" />
            <p className="font-display text-lg font-semibold text-navy-600">
              Service-area map coming soon
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              An interactive pickup-area map is on the way. Until then, your ZIP code in
              the booking flow is the source of truth.
            </p>
          </Reveal>
        </div>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Flying out of JFK, LGA, or EWR?
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book/zip">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
