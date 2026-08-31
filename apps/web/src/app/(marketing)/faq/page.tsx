import type { Metadata } from "next";
import { FAQAccordion, Reveal, Section, SectionHeader } from "@koolee/ui";

import { ContactEmailLink } from "@/components/contact-email-link";
import { FAQS } from "@/lib/faq";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about Koolee's doorstep luggage pickup: security and sealed-bag chain of custody, weight limits, flight changes, refunds, and coverage at JFK, LGA, and EWR.",
};

export default function FAQPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="FAQ"
            heading="Everything people ask before handing us a bag."
            body="Straight answers, especially to the hard questions. If yours isn't here, email us — a human reads every message."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-label="Frequently asked questions">
        <Reveal className="mx-auto max-w-3xl">
          <FAQAccordion items={FAQS} defaultOpenId="safety" />
          <p className="mt-10 text-sm text-muted-foreground">
            Still curious? <ContactEmailLink />
          </p>
        </Reveal>
      </Section>
    </>
  );
}
