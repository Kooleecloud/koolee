import type { Metadata } from "next";
import { Reveal, Section, SectionHeader } from "@koolee/ui";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Koolee's Privacy Policy — draft. What we collect to run doorstep luggage pickup, how we use it, and the choices you have.",
  robots: { index: false },
};

const SECTIONS = [
  {
    title: "1. What we collect",
    body: "Account details (phone number, and optionally name and email), booking details (flight, pickup address, bag count), payment details (processed by our payment provider — Koolee does not store card numbers), and custody records (seal serials, hand-off photos, timestamps, and vehicle location during your trip).",
  },
  {
    title: "2. How we use it",
    body: "To operate your pickup: verifying the traveler at the door, computing pickup windows from airline cutoffs, coordinating agents and drivers, and building the chain-of-custody timeline you see on your trip page. We send transactional messages (booking confirmations, trip updates) to your phone number.",
  },
  {
    title: "3. What we don't do",
    body: "We do not sell your personal information. We do not use your custody photos for marketing. Hand-off photos exist to document the condition and possession of your bags, and retention windows for them will be finalized in this section.",
  },
  {
    title: "4. Sharing",
    body: "We share data with service providers who run our infrastructure (hosting, authentication, payments, SMS delivery) under contracts limiting their use of it, and when required by law. Agents and drivers see only what they need for your pickup: name, address, window, and bag count.",
  },
  {
    title: "5. Your choices",
    body: "You can access or delete your account data by contacting us. Deleting your account removes personal details, subject to records we must keep for completed trips (payments, custody logs) under applicable law. Retention periods will be finalized in this section.",
  },
  {
    title: "6. Security",
    body: "Data is encrypted in transit, access is role-restricted, and sign-in uses one-time codes rather than passwords. No system is perfectly secure; we will notify affected customers of any breach as required by law.",
  },
];

export default function PrivacyPage() {
  return (
    <Section space="compact" className="pt-12 sm:pt-16">
      <Reveal className="mx-auto max-w-3xl">
        <SectionHeader
          as="h1"
          eyebrow="Legal"
          heading="Privacy Policy"
          body="What we collect to move your bags carefully, and what we do — and don't do — with it."
        />
        <p className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-navy-800">
          Draft — this document is a working draft under legal review and is not yet in
          force. Sections marked &ldquo;will be finalized&rdquo; are placeholders.
        </p>
        <div className="mt-10 flex flex-col gap-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-lg font-semibold text-navy-800">
                {section.title}
              </h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted-foreground">
          Privacy questions:{" "}
          <a
            href="mailto:hello@koolee.nyc"
            className="text-sky-700 underline underline-offset-4 hover:text-sky-600"
          >
            hello@koolee.nyc
          </a>
        </p>
      </Reveal>
    </Section>
  );
}
