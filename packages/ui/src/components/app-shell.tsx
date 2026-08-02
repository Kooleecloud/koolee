import * as React from "react";

import { cn } from "../lib/utils";
import { KooleeLogo } from "./koolee-logo";

/*
 * The standardized in-app frame, shared by every post-login surface in web,
 * admin, and agent (marketing keeps MarketingNav/MarketingFooter).
 *
 * Frame decisions (do not re-derive per app):
 *  - Header chrome spans the full `container` (1280px) on every surface, same
 *    metrics as MarketingNav (`h-16`), so the logo never jumps between pages.
 *  - Content sits in ONE standard column per surface type: `default`
 *    (max-w-3xl) for customer/admin pages, `narrow` (max-w-md) for auth forms
 *    and the phone-first agent app, `full` for dense admin tables.
 *  - Vertical rhythm is fixed: `py-10` page padding, `gap-6` between blocks.
 */

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
  /** Sticky by default, matching MarketingNav. */
  sticky?: boolean;
  className?: string;
}

/** One header for all in-app surfaces: logo home-link + nav + actions slot. */
function AppHeader({
  links,
  actions,
  linkComponent: LinkComponent = "a",
  homeHref = "/",
  sticky = true,
  className,
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        "border-b border-border bg-white",
        sticky && "sticky top-0 z-40",
        className,
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <LinkComponent
            href={homeHref}
            className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <KooleeLogo />
          </LinkComponent>
          {links && links.length > 0 ? (
            <nav aria-label="Main">
              <ul className="flex items-center gap-1">
                {links.map((link) => (
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
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

const CONTENT_WIDTHS = {
  /** Customer post-login and admin detail pages. */
  default: "max-w-3xl",
  /** Auth forms and the phone-first agent app. */
  narrow: "max-w-md",
  /** Dense admin tables. */
  full: "",
} as const;

export interface ContentColumnProps extends React.HTMLAttributes<HTMLElement> {
  width?: keyof typeof CONTENT_WIDTHS;
  /** Rendered element. One `main` per page. */
  as?: "main" | "div" | "section";
}

/** The standard content column: centered, fixed rhythm, one width standard. */
function ContentColumn({
  width = "default",
  as: Comp = "main",
  className,
  ...props
}: ContentColumnProps) {
  return (
    <Comp
      className={cn(
        "container flex flex-col gap-6 py-10",
        CONTENT_WIDTHS[width],
        className,
      )}
      {...props}
    />
  );
}

export interface AppFooterProps {
  /** Trust copy, legal fine print, contact link — app-specific. */
  children: React.ReactNode;
  /** Match the page's ContentColumn width. */
  width?: keyof typeof CONTENT_WIDTHS;
  className?: string;
}

/** Quiet in-app footer strip, aligned to the content column. */
function AppFooter({ children, width = "default", className }: AppFooterProps) {
  return (
    <footer className={cn("container pb-10", CONTENT_WIDTHS[width], className)}>
      <div className="border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </footer>
  );
}

export { AppHeader, ContentColumn, AppFooter };
