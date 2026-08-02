import Link from "next/link";
import type { FAQItem } from "@koolee/ui";

/**
 * Canonical FAQ content. The landing page shows the first four; /faq shows all.
 *
 * Copy rules (root README + brand): we deliver to the airline's bag drop. We
 * never claim to check anyone in, hand bags to TSA, or load aircraft. No
 * fabricated stats — trust is process transparency.
 */

const faqLink = "text-sky-700 underline underline-offset-4 hover:text-sky-600";

export const FAQS: FAQItem[] = [
  {
    id: "safety",
    question: "How do I know my bags are safe with a stranger?",
    answer: (
      <>
        <p>
          Because you never have to take our word for it. Every Koolee agent is
          identity-verified and background-checked before their first pickup. At your
          door, the agent confirms the traveler&apos;s ID against the booking, weighs
          each bag, and closes it with a serialized tamper-evident seal — while you
          watch. Every hand-off after that is logged with a photo and timestamp on a
          live timeline you can open at any moment.
        </p>
        <p className="mt-3">
          If a seal arrives broken or its serial doesn&apos;t match, you&apos;ll know —
          and so will we.
        </p>
      </>
    ),
  },
  {
    id: "open-bags",
    question: "Do you ever open my bags?",
    answer: (
      <p>
        No. Your bags are sealed at your door, in front of you, and the seal&apos;s
        serial number is recorded on your booking. From that moment, no one at Koolee
        opens them. Once we deliver them to your airline&apos;s bag drop, they follow
        the airline&apos;s normal checked-baggage process — exactly as if you had
        brought them to the counter yourself.
      </p>
    ),
  },
  {
    id: "flight-changes",
    question: "What happens if my flight changes or is delayed?",
    answer: (
      <p>
        Your pickup window is calculated from your airline&apos;s bag-drop cutoff, with
        buffer built in. If your flight changes before pickup, update your booking and
        we recompute the window. If it changes after pickup, our team coordinates the
        new drop-off time directly. And if a change on our side ever means we
        can&apos;t make your cutoff, we tell you immediately and you don&apos;t pay for
        the trip.
      </p>
    ),
  },
  {
    id: "check-in",
    question: "Do I still need to check in for my flight?",
    answer: (
      <p>
        Yes. Koolee handles your checked bags&apos; journey from your door to your
        airline&apos;s bag-drop counter — check-in itself stays exactly as it is
        today. Check in online or at the airport as usual; then walk past the bag line
        with your hands free.
      </p>
    ),
  },
  {
    id: "weight-limits",
    question: "Is there a weight or size limit?",
    answer: (
      <p>
        Your airline&apos;s checked-bag rules apply — we don&apos;t add limits of our
        own. Your agent weighs each bag at your door, so an overweight bag is caught in
        your hallway, not at the airport counter. If a bag is over your airline&apos;s
        limit, you can repack on the spot before it&apos;s sealed.
      </p>
    ),
  },
  {
    id: "custody",
    question: "How does the chain of custody actually work?",
    answer: (
      <>
        <p>Four links, every one of them recorded:</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            <strong>Pickup.</strong> Agent verifies the traveler&apos;s ID, weighs and
            seals each bag, photographs everything.
          </li>
          <li>
            <strong>Transfer.</strong> Bags move to a tracked vehicle; the hand-off is
            photographed and timestamped.
          </li>
          <li>
            <strong>Transit.</strong> The ride to the airport is live-tracked on your
            trip page.
          </li>
          <li>
            <strong>Bag drop.</strong> Delivery to your airline&apos;s bag-drop counter
            is photographed and confirmed on your timeline.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "refunds",
    question: "What's your refund policy?",
    answer: (
      <p>
        If we miss your airline&apos;s bag-drop cutoff for a reason within our control,
        the trip is free — full refund, no forms. Cancellation windows and the full
        policy live in our{" "}
        <Link href="/terms" className={faqLink}>
          Terms of Service
        </Link>
        .
      </p>
    ),
  },
  {
    id: "coverage",
    question: "Which airports and neighborhoods do you cover?",
    answer: (
      <p>
        We deliver to JFK, LaGuardia, and Newark, with pickups across Manhattan, parts
        of Brooklyn and Queens, and Jersey City. Somewhere else?{" "}
        <Link href="/waitlist" className={faqLink}>
          Join the waitlist
        </Link>{" "}
        and we&apos;ll email you the day your neighborhood opens.
      </p>
    ),
  },
];

/** The four questions most first-time visitors ask, for the landing teaser. */
export const TOP_FAQS = FAQS.slice(0, 4);
