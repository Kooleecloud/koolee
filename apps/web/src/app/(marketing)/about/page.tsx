import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CTAButton,
  MilestoneTrack,
  Reveal,
  SealMotif,
  Section,
  SectionHeader,
  StatBadge,
} from "@koolee/ui";
import {
  ArrowUpRight,
  BadgeCheck,
  Camera,
  GraduationCap,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why we built Koolee: off-airport luggage pickup, sealed at your door and delivered to your airline's bag drop at JFK, LGA, and EWR — so New Yorkers travel to the airport carrying nothing.",
};

const VETTING = [
  {
    icon: <BadgeCheck aria-hidden="true" className="size-6 text-sky-600" />,
    title: "Identity, verified",
    body: "Every agent's government ID is verified before their first shift, and every pickup is tied to a named, accountable agent on our side.",
  },
  {
    icon: <ShieldCheck aria-hidden="true" className="size-6 text-sky-600" />,
    title: "Background-checked",
    body: "Agents pass a criminal background check before joining, period. There is no fast lane around it.",
  },
  {
    icon: <GraduationCap aria-hidden="true" className="size-6 text-sky-600" />,
    title: "Trained on the protocol",
    body: "ID check, weigh, seal, photograph — in that order, every time. Agents train on the sealed-bag protocol and are audited against it.",
  },
  {
    icon: <Camera aria-hidden="true" className="size-6 text-sky-600" />,
    title: "Accountable on the record",
    body: "Every hand-off an agent makes is photographed and timestamped. Good behavior isn't a promise here; it's a log.",
  },
];

/**
 * Both bios open the same way — "<Name> leads …" — because the founder review
 * landed on exactly that: a role defined by what someone leads, not by what
 * they are not. The `track` chain exists for the same reason; a trajectory that
 * ends on Koolee argues for itself in a way a job title cannot.
 *
 * Everything in these bios is checkable. No invented dates, no invented
 * outcomes at former employers.
 */
const FOUNDERS = [
  {
    name: "Karun Rathi",
    role: "Co-founder · Strategy, Partnerships & Growth",
    photo: "/karun_dp.jpeg",
    // Founder seals: the first two serials Koolee ever issued.
    serial: "NYC 000001",
    linkedin: "https://www.linkedin.com/in/karunrathi/",
    bio: "Karun leads Koolee — driving strategy, finance, partnerships, pricing, and growth. A Kelley School of Business grad and former NCAA tennis player, he's worked in logistics at Fonterra, one of the world's largest dairy cooperatives, automated workflows as a Business Intelligence Analyst at Indiana University, built one of the first collegiate esports clubs in the U.S., and started an airport shuttle business in his college town before Uber Shuttle existed. Now he's putting that experience to work at Koolee, simplifying complex logistical challenges into seamless experiences.",
    track: [
      "Fonterra · logistics",
      "Indiana University · BI analyst",
      "Collegiate esports club",
      "Campus airport shuttle",
      "Koolee",
    ],
  },
  {
    name: "Tarun Dadlani",
    role: "Co-founder · Technology & Product",
    photo: "/tarun_dp.jpeg",
    serial: "NYC 000002",
    linkedin: "https://www.linkedin.com/in/tarun-dadlani/",
    bio: "Tarun leads Koolee's technology — the booking flow that prices your trip, the seal-verification system your agent carries to your door, the live timeline you watch from the couch, and the custody record underneath all of it. A full-stack engineer with a master's in computer science from Stevens Institute of Technology, he's shipped software for healthcare and security companies, where a lost record is a liability rather than an inconvenience. He built Koolee to that standard: every hand-off writes an entry that can be added to but never edited or deleted — so the trail behind your bags is one nobody here can quietly rewrite, including him.",
    track: [
      "Stevens Institute · MS CS",
      "Healthcare platforms",
      "Security systems",
      "Koolee",
    ],
  },
];

export default function AboutPage() {
  return (
    <>
      <Section space="compact" className="pt-12 sm:pt-16">
        <Reveal>
          <SectionHeader
            as="h1"
            eyebrow="About Koolee"
            heading="We started with a suitcase on a subway staircase."
            body="Anyone who has hauled a month of luggage up the stairs at Court Square, or folded a stroller with one hand at a curb on Canal Street, knows the worst part of flying happens before the airport. We built Koolee to delete that part."
          />
        </Reveal>
      </Section>

      <Section space="compact" aria-labelledby="mission-heading">
        <Reveal className="grid items-start gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <h2
              id="mission-heading"
              className="font-display text-display-sm font-semibold text-navy-800"
            >
              The idea is simple
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              A vetted Koolee agent comes to your door, verifies your ID against the
              booking, weighs and seals your bags with a numbered, tamper-evident tag,
              and sends them to the airport in a tracked vehicle. You can follow their
              journey in your Koolee timeline as we deliver them directly to your
              airline&apos;s bag drop before its cutoff. You check in online as usual,
              skip the bag-drop line, and head straight to security.
            </p>
            {/* The positioning statement, set apart because it is the boundary
                of the claim — what we do, and just as importantly what we don't. */}
            <p className="border-l-2 border-sky-400 pl-5 text-lg leading-relaxed font-medium text-navy-800">
              We&apos;re not a storage service, a shipping company, or a travel agency.
              We do one thing: take your checked bags from your door to your
              airline&apos;s bag drop — carefully, securely, and in plain sight.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-4 rounded-2xl bg-navy-50 p-8">
            <SealMotif className="h-16 self-start" />
            <p className="leading-relaxed text-navy-800">
              The hardest question we get is the right one:{" "}
              <em>&ldquo;Why would I trust a stranger with my bags?&rdquo;</em>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Our answer isn&apos;t a slogan. It&apos;s a process you can see: vetted
              agents, tamper-evident seals, a photo at every handoff, and a live
              timeline from your doorstep to the airline bag drop. You never have to
              take our word for it. Every step is visible, documented, and trackable.
            </p>
          </div>
        </Reveal>
      </Section>

      <Section space="compact" aria-labelledby="founders-heading">
        <Reveal>
          <SectionHeader
            eyebrow="The founders"
            heading={
              <span id="founders-heading">Built by two people you can name</span>
            }
            body="Two founders, personally accountable for every bag we carry. No layers between you and the people who built this."
          />
        </Reveal>
        <div className="mt-10 flex flex-col gap-5">
          {FOUNDERS.map((founder) => (
            <Reveal key={founder.name}>
              <div className="grid items-start gap-8 rounded-2xl border border-border bg-white p-6 shadow-lift sm:grid-cols-[auto_1fr] sm:gap-10 sm:p-8">
                <div className="relative self-start pt-9 sm:w-40">
                  <SealMotif
                    serial={founder.serial}
                    label={null}
                    className="absolute top-0 left-0 h-10 -rotate-6"
                  />
                  <Image
                    src={founder.photo}
                    alt={founder.name}
                    width={400}
                    height={400}
                    className="size-32 rounded-full object-cover ring-4 ring-sky-50 sm:size-36"
                  />
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-navy-800">
                      {founder.name}
                    </h3>
                    <p className="text-sm font-medium text-sky-600">{founder.role}</p>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">{founder.bio}</p>
                  <MilestoneTrack label="Track record" items={founder.track} />
                  <a
                    href={founder.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-sky-600 transition-colors hover:text-sky-700"
                  >
                    LinkedIn
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="raised" aria-labelledby="vetting-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Our agents"
            heading={
              <span id="vetting-heading">The backbone of our whole operation</span>
            }
            body="Everything about Koolee depends on who rings your doorbell. So that's where we set the highest bar."
          />
        </Reveal>
        <Reveal stagger={0.08} className="mt-10 grid gap-5 sm:grid-cols-2">
          {VETTING.map((item) => (
            <div
              key={item.title}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-6 shadow-lift"
            >
              <div className="w-fit rounded-xl bg-sky-50 p-3">{item.icon}</div>
              <h3 className="font-display text-lg font-semibold text-navy-800">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </Reveal>
        <Reveal className="mt-10 flex flex-wrap gap-3">
          <StatBadge label="Serialized seals" description="on every bag" />
          <StatBadge label="Photo proof" description="at every hand-off" />
          <StatBadge label="Live timeline" description="on every trip" />
        </Reveal>
      </Section>

      <Section tone="navy" space="compact">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-display text-display-sm font-semibold text-white">
            Travel light. We&apos;ll do the heavy lifting.
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
