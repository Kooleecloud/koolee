import { MarketingFooter, MarketingNav } from "@koolee/ui";

import { AuthNavActions } from "@/components/auth-nav-actions";
import { ClientLink } from "@/components/client-link";
import { SITE } from "@/lib/site";

const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/airports", label: "Airports" },
  // Who is behind this is a top-level question for a service that comes to
  // your door, so it belongs in the header — not only in the footer.
  { href: "/about", label: "About us" },
  { href: "/faq", label: "FAQ" },
];

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/airports", label: "Airports" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/waitlist", label: "Waitlist" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingNav links={NAV_LINKS} linkComponent={ClientLink} actions={<AuthNavActions />} />
      <main className="flex-1">{children}</main>
      <MarketingFooter
        groups={FOOTER_GROUPS}
        linkComponent={ClientLink}
        contactEmail={SITE.contactEmail}
      />
    </div>
  );
}
