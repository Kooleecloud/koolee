import type { Metadata } from "next";
import { Reveal, Section, SectionHeader } from "@koolee/ui";

import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description:
    "Koolee doesn't reach your neighborhood yet? Leave your email and we'll let you know the day doorstep luggage pickup opens in your area.",
};

export default function WaitlistPage() {
  return (
    <Section space="compact" className="pt-12 sm:pt-16">
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="Waitlist"
            heading="Not in your neighborhood yet?"
            body="We're expanding the pickup area street by street. Leave your email — and your ZIP if you like — and we'll send exactly one message: the one that says you're covered."
          />
        </Reveal>
        <Reveal delay={0.1}>
          <WaitlistForm />
        </Reveal>
      </div>
    </Section>
  );
}
