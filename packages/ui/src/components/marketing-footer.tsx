import * as React from "react";

import { cn } from "../lib/utils";
import { KooleeLogo } from "./koolee-logo";

export interface FooterLinkGroup {
  title: string;
  links: { href: string; label: string }[];
}

export interface MarketingFooterProps extends React.HTMLAttributes<HTMLElement> {
  groups: FooterLinkGroup[];
  contactEmail?: string;
  /** Link element for client-side navigation (pass Next.js `Link`). */
  linkComponent?: React.ElementType;
  tagline?: string;
  /** Short coverage line, e.g. "Serving JFK · LGA · EWR". */
  coverage?: string;
}

function MarketingFooter({
  groups,
  contactEmail,
  linkComponent: LinkComponent = "a",
  tagline = "Fly Hassle-Free.",
  coverage = "Serving JFK · LGA · EWR",
  className,
  ...props
}: MarketingFooterProps) {
  return (
    <footer className={cn("bg-navy-900 text-navy-100", className)} {...props}>
      <div className="container grid gap-12 py-16 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col items-start gap-4">
          <KooleeLogo className="text-white" />
          <p className="font-display text-lg font-medium text-white">{tagline}</p>
          <p className="text-sm text-navy-200">{coverage}</p>
          {contactEmail ? (
            <a
              href={`mailto:${contactEmail}`}
              className={cn(
                "text-sm text-sky-300 underline-offset-4 transition-colors",
                "hover:text-sky-200 hover:underline focus-visible:outline-hidden",
                "focus-visible:ring-2 focus-visible:ring-sky-400 rounded-sm",
              )}
            >
              {contactEmail}
            </a>
          ) : null}
        </div>

        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-300">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <LinkComponent
                    href={link.href}
                    className={cn(
                      "rounded-sm text-sm text-navy-100 transition-colors hover:text-white",
                      "focus-visible:outline-hidden focus-visible:ring-2",
                      "focus-visible:ring-sky-400",
                    )}
                  >
                    {link.label}
                  </LinkComponent>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-2 py-6 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Koolee. All rights reserved.</p>
          <p>Made in New York.</p>
        </div>
      </div>
    </footer>
  );
}

export { MarketingFooter };
