import type { Metadata } from "next";
import Link from "next/link";
import {
  AirportCard,
  CoverageScene,
  CTAButton,
  Reveal,
  Section,
  SectionHeader,
} from "@koolee/ui";

export const metadata: Metadata = {
  title: "Airports & coverage",
  description:
    "Koolee delivers sealed bags to your airline's bag drop at JFK, LaGuardia, and Newark, with doorstep pickups across all five NYC boroughs and Hudson County, NJ.",
};

/**
 * No per-airport cutoff note here any more. Bag-drop cutoffs are load-bearing
 * inside the booking flow — the window picker will not offer a window that
 * misses one — but as marketing copy they described our arithmetic instead of
 * the traveller's day.
 */
const AIRPORTS = [
  {
    code: "JFK",
    name: "John F. Kennedy International",
    body: "All terminals, all airlines with a bag-drop counter. The long haul out to Queens is exactly the trip you'll be glad to skip with luggage in tow.",
  },
  {
    code: "LGA",
    name: "LaGuardia",
    body: "All terminals. Close to the city but famously awkward to reach by transit with bags — we take that part off your hands.",
  },
  {
    code: "EWR",
    name: "Newark Liberty International",
    body: "All terminals. Cross-Hudson with luggage is nobody's favorite leg — pickups from anywhere in the five boroughs or Hudson County cover it.",
  },
];

const COVERAGE_AREAS = [
  { area: "Manhattan", detail: "All neighborhoods" },
  { area: "Brooklyn", detail: "All neighborhoods" },
  { area: "Queens", detail: "All neighborhoods, including the Rockaways" },
  { area: "The Bronx", detail: "All neighborhoods" },
  { area: "Staten Island", detail: "All neighborhoods" },
  { area: "Hudson County, NJ", detail: "Jersey City, Hoboken, and neighbors" },
];

export default function AirportsPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="Coverage"
            heading="Three airports, one easy departure."
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

      <Section tone="raised" aria-labelledby="service-area-heading">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal className="flex flex-col items-start gap-6">
            <SectionHeader
              eyebrow="Pickup area"
              heading={<span id="service-area-heading">Where we knock</span>}
              body="Enter your ZIP in the booking flow and we'll confirm instantly. Outside the area? Join the waitlist and we'll email you the day your neighborhood opens."
            />
            <ul className="flex w-full max-w-md flex-col divide-y divide-border rounded-2xl border border-border bg-background shadow-lift">
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

          <Reveal>
            <CoverageScene
              airports={["LGA", "JFK", "EWR"]}
              caption="Schematic, not to scale. One pickup area, three airline bag drops — your ZIP confirms the exact address at booking."
            />
          </Reveal>
        </div>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Flying out of JFK, LGA, or EWR?
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
