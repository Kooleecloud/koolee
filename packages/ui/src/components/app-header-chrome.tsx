"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, X } from "lucide-react";

import { cn } from "../lib/utils";

export interface AppHeaderChromeProps {
  /** Logo home-link, pre-rendered by the server AppHeader. */
  brand: React.ReactNode;
  /** Desktop nav (`hidden md:block`), pre-rendered by the server AppHeader. */
  nav?: React.ReactNode;
  /** Right-side slot — session controls, back links, CTAs. */
  actions?: React.ReactNode;
  /** Mobile panel content, pre-rendered by the server AppHeader. */
  panel?: React.ReactNode;
  /** Whether nav links exist — gates the hamburger and panel. */
  hasMenu: boolean;
  sticky?: boolean;
  className?: string;
}

/**
 * Client half of AppHeader: owns the hamburger state and the animated mobile
 * panel. All link/action markup arrives pre-rendered from the server half
 * (app-header.tsx) so `linkComponent` never crosses the RSC boundary — only
 * serializable elements do.
 */
function AppHeaderChrome({
  brand,
  nav,
  actions,
  panel,
  hasMenu,
  sticky = true,
  className,
}: AppHeaderChromeProps) {
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

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
        "border-b border-border bg-white",
        sticky && "sticky top-0 z-40",
        className,
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {brand}
          {nav}
        </div>

        {actions || hasMenu ? (
          <div className="flex shrink-0 items-center gap-3">
            {actions ? (
              <div className={cn("items-center gap-3", hasMenu ? "hidden md:flex" : "flex")}>
                {actions}
              </div>
            ) : null}
            {hasMenu ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="app-header-menu"
                aria-label={open ? "Close menu" : "Open menu"}
                className={cn(
                  "inline-flex size-10 items-center justify-center rounded-md text-navy-800",
                  "hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2",
                  "focus-visible:ring-ring md:hidden",
                )}
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasMenu ? (
        <AnimatePresence>
          {open && (
            <motion.div
              id="app-header-menu"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-border bg-white md:hidden"
              onClick={() => setOpen(false)}
            >
              {panel}
            </motion.div>
          )}
        </AnimatePresence>
      ) : null}
    </header>
  );
}

export { AppHeaderChrome };
