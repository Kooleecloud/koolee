import type { Metadata } from "next";
import { Reveal, Section, SectionHeader } from "@koolee/ui";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Koolee's Terms of Service — draft. The agreement covering doorstep luggage pickup and delivery to your airline's bag drop.",
  robots: { index: false },
};

const SECTIONS = [
  {
    title: "1. The service",
    body: "Koolee collects checked luggage at a customer's pickup address, applies serialized tamper-evident seals, transports the sealed bags to the departure airport, and delivers them to the customer's airline bag-drop counter. Koolee does not complete any airline formalities on a customer's behalf, does not act as an agent of any airline, and does not transport passengers.",
  },
  {
    title: "2. Bookings and payment",
    body: "Bookings are confirmed on payment. The price shown at checkout — base fee, per-bag rate, distance amount, and window selection — is the full amount charged. Pickup windows are offered based on the airline's published bag-drop cutoff for the booked flight.",
  },
  {
    title: "3. Customer responsibilities",
    body: "The traveler named on the booking must be present at pickup with valid ID. Bags must comply with the airline's checked-baggage rules and with applicable law. Prohibited items in checked baggage are the customer's responsibility, as they would be at the airline counter.",
  },
  {
    title: "4. Cancellations and refunds",
    body: "Cancellations before an agent is dispatched receive a full refund. If Koolee fails to deliver bags before the airline's bag-drop cutoff for a reason within Koolee's control, the trip fee is refunded in full. Detailed cancellation windows will be finalized in this section.",
  },
  {
    title: "5. Care of bags and liability",
    body: "Bags remain sealed from pickup to bag-drop delivery, with each hand-off photographed and timestamped. Koolee's liability for loss or damage while bags are in Koolee's custody, and the claims process, will be finalized in this section. After delivery to the airline's bag drop, the airline's conditions of carriage govern.",
  },
  {
    title: "6. Service area and timing",
    body: "Service is available for departures from JFK, LGA, and EWR, with pickups in Koolee's published coverage area. Pickup windows are computed from airline cutoffs, drive time, and a buffer; Koolee may decline bookings that cannot safely meet a cutoff.",
  },
  {
    title: "7. Changes to these terms",
    body: "Koolee may update these terms; material changes will be notified to customers with active bookings. Continued use after changes take effect constitutes acceptance.",
  },
];

export default function TermsPage() {
  return (
    <Section space="compact" className="pt-12 sm:pt-16">
      <Reveal className="mx-auto max-w-3xl">
        <SectionHeader
          as="h1"
          eyebrow="Legal"
          heading="Terms of Service"
          body="The agreement between you and Koolee for luggage pickup and bag-drop delivery."
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
          Questions about these terms:{" "}
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
