import * as React from "react";

import { cn } from "../lib/utils";
import { AppHeaderChrome } from "./app-header-chrome";
import { KooleeLogo } from "./koolee-logo";

export interface AppNavLink {
  href: string;
  label: string;
}

export interface AppHeaderProps {
  /** Primary nav links, rendered next to the logo (e.g. admin sections). */
  links?: AppNavLink[];
  /** Right-side slot — session controls, back links, CTAs. */
  actions?: React.ReactNode;
  /** Link element for client-side navigation (pass Next.js `Link`). */
  linkComponent?: React.ElementType;
  homeHref?: string;
  /**
   * Short surface label rendered as a chip after the wordmark ("ops",
   * "agent") so the staff consoles are tellable apart at a glance — on the
   * login screens especially. Customer web passes none.
   */
  tag?: string;
  /** Sticky by default, matching MarketingNav. */
  sticky?: boolean;
  className?: string;
}

/**
 * One header for all in-app surfaces: logo home-link + nav + actions slot.
 * Below `md` the nav and actions collapse behind a hamburger, same pattern
 * (and metrics) as MarketingNav. With no links there is no toggle and the
 * actions stay inline at every width — the logo-only agent surface and the
 * booking flow's single back-link fit as-is.
 *
 * Stays a server component so `linkComponent={Link}` works from RSC layouts:
 * all link markup is rendered here and handed to the client half
 * (AppHeaderChrome) as elements — component functions never cross the
 * serialization boundary.
 */
function AppHeader({
  links,
  actions,
  linkComponent: LinkComponent = "a",
  homeHref = "/",
  tag,
  sticky = true,
  className,
}: AppHeaderProps) {
  const hasMenu = Boolean(links && links.length > 0);

  return (
    <AppHeaderChrome
      hasMenu={hasMenu}
      sticky={sticky}
      className={className}
      brand={
        <LinkComponent
          href={homeHref}
          className="inline-flex items-center gap-2 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <KooleeLogo />
          {tag ? (
            <span className="rounded-sm bg-navy-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy-700">
              {tag}
            </span>
          ) : null}
        </LinkComponent>
      }
      nav={
        hasMenu ? (
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {links?.map((link) => (
                <li key={link.href}>
                  <LinkComponent
                    href={link.href}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium text-navy-700",
                      "transition-colors hover:bg-navy-50 hover:text-navy-900",
                      "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {link.label}
                  </LinkComponent>
                </li>
              ))}
            </ul>
          </nav>
        ) : null
      }
      actions={actions}
      panel={
        hasMenu ? (
          <ul className="container flex flex-col gap-1 py-4">
            {links?.map((link) => (
              <li key={link.href}>
                <LinkComponent
                  href={link.href}
                  className={cn(
                    "block rounded-md px-3 py-2.5 text-base font-medium text-navy-800",
                    "hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2",
                    "focus-visible:ring-ring",
                  )}
                >
                  {link.label}
                </LinkComponent>
              </li>
            ))}
            {actions ? (
              <li className="mt-3 flex flex-col gap-3 border-t border-border pt-4">
                {actions}
              </li>
            ) : null}
          </ul>
        ) : null
      }
    />
  );
}

export { AppHeader };
