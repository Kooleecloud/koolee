import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CTAButton,
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
    "Why we built Koolee: doorstep luggage pickup, sealed and delivered to your airline's bag drop at JFK, LGA, and EWR — so New Yorkers can travel to the airport carrying nothing.",
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
    body: "Agents pass a criminal background check before joining, full stop. There is no fast lane around it.",
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

const FOUNDERS = [
  {
    name: "Karun Rathi",
    role: "Co-founder · Business & Growth",
    photo: "/karun_dp.jpeg",
    // Founder seals: the first two serials Koolee ever issued.
    serial: "NYC 000001",
    linkedin: "https://www.linkedin.com/in/karunrathi/",
    bio: "Karun runs everything at Koolee that isn't code: finance, partnerships, pricing, and growth. A Kelley School of Business grad and former NCAA tennis player, he's spent his life optimizing logistics — first his own across two continents, now yours across three airports.",
  },
  {
    name: "Tarun Dadlani",
    role: "Co-founder · Technology",
    photo: "/tarun_dp.jpeg",
    serial: "NYC 000002",
    linkedin: "https://www.linkedin.com/in/tarun-dadlani/",
    bio: "Tarun builds all of Koolee: the booking flow, the live bag timeline, the seal-verification system. A full-stack engineer with a master's in CS from Stevens Institute of Technology, he's shipped software for healthcare and security companies — and now for your suitcase.",
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
        <Reveal className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h2
              id="mission-heading"
              className="font-display text-display-sm font-semibold text-navy-800"
            >
              The idea is simple
            </h2>
            <div className="flex flex-col gap-4 leading-relaxed text-muted-foreground">
              <p>
                A vetted Koolee agent comes to your door, checks the traveler&apos;s ID
                against the booking, weighs your bags, and seals each one with a
                serialized tamper-evident tag while you watch. Your bags ride to the
                airport in a tracked vehicle, and we hand them to your airline&apos;s
                bag-drop counter before your cutoff. You check in as usual — and walk
                through the terminal carrying nothing.
              </p>
              <p>
                We are deliberately not a storage service, not a shipping company, and
                not a travel agency. We do one thing: your checked bags&apos; journey
                from your door to your airline&apos;s bag drop, done carefully and in
                plain sight.
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-4 rounded-2xl bg-navy-50 p-8">
            <SealMotif className="h-16 self-start" />
            <p className="leading-relaxed text-navy-800">
              The hardest question we get is the right one:{" "}
              <em>&ldquo;Why would I trust a stranger with my bags?&rdquo;</em>
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Our answer isn&apos;t a slogan. It&apos;s a process you can watch: vetted
              people, serialized seals, a photo at every hand-off, and a live timeline
              from your doorstep to the counter. We designed Koolee so you never have
              to take our word for anything.
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
            body="Koolee is two founders, bootstrapped, doing this the hard way — no warehouse of investors between you and the people responsible for your bags."
          />
        </Reveal>
        <Reveal stagger={0.08} className="mt-10 grid gap-5 sm:grid-cols-2">
          {FOUNDERS.map((founder) => (
            <div
              key={founder.name}
              className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-white p-8 text-center shadow-lift"
            >
              <div className="relative mt-8">
                <SealMotif
                  serial={founder.serial}
                  label={null}
                  className="absolute -top-8 left-1/2 h-10 -translate-x-4 -rotate-6"
                />
                <Image
                  src={founder.photo}
                  alt={founder.name}
                  width={400}
                  height={400}
                  className="size-36 rounded-full object-cover ring-4 ring-sky-50"
                />
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold text-navy-800">
                  {founder.name}
                </h3>
                <p className="text-sm font-medium text-sky-600">{founder.role}</p>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {founder.bio}
              </p>
              <a
                href={founder.linkedin}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 transition-colors hover:text-sky-700"
              >
                LinkedIn
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            </div>
          ))}
        </Reveal>
      </Section>

      <Section tone="raised" aria-labelledby="vetting-heading">
        <Reveal>
          <SectionHeader
            eyebrow="Our agents"
            heading={<span id="vetting-heading">The people we send to your door</span>}
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
            Travel light. We&apos;ve got the heavy part.
          </h2>
          <CTAButton size="lg" asChild>
            <Link href="/book">Book a pickup</Link>
          </CTAButton>
        </Reveal>
      </Section>
    </>
  );
}
