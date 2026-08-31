"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, X } from "lucide-react";

import { cn } from "../lib/utils";
import { KooleeLogo } from "./koolee-logo";

export interface MarketingNavLink {
  href: string;
  label: string;
}

export interface MarketingNavProps {
  links: MarketingNavLink[];
  /** Right-side slot — the CTA, or session-aware controls. */
  actions?: React.ReactNode;
  /** Link element for client-side navigation (pass Next.js `Link`). */
  linkComponent?: React.ElementType;
  homeHref?: string;
  className?: string;
}

/**
 * Sticky marketing navbar. Transparent over the hero, frosted once scrolled.
 * Session-awareness is composed by the app through `actions`.
 */
function MarketingNav({
  links,
  actions,
  linkComponent: LinkComponent = "a",
  homeHref = "/",
  className,
}: MarketingNavProps) {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300",
        scrolled || open
          ? "border-b border-border bg-background/85 shadow-xs backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
        className,
      )}
    >
      <nav
        aria-label="Main"
        className="container flex h-16 items-center justify-between gap-4"
      >
        <LinkComponent
          href={homeHref}
          className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <KooleeLogo />
        </LinkComponent>

        <ul className="hidden items-center gap-1 md:flex">
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

        <div className="hidden items-center gap-3 md:flex">{actions}</div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="marketing-nav-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className={cn(
            "inline-flex size-10 items-center justify-center rounded-md text-navy-800",
            "hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2",
            "focus-visible:ring-ring md:hidden",
          )}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id="marketing-nav-menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border bg-background md:hidden"
          >
            <ul className="container flex flex-col gap-1 py-4">
              {links.map((link) => (
                <li key={link.href} onClick={() => setOpen(false)}>
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
                <li
                  className="mt-3 flex flex-col gap-3 border-t border-border pt-4"
                  onClick={() => setOpen(false)}
                >
                  {actions}
                </li>
              ) : null}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export { MarketingNav };
