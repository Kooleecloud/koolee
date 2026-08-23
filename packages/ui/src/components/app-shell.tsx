import * as React from "react";

import { cn } from "../lib/utils";

/*
 * The standardized in-app frame, shared by every post-login surface in web,
 * admin, and agent (marketing keeps MarketingNav/MarketingFooter).
 *
 * Frame decisions (do not re-derive per app):
 *  - Header chrome spans the full `container` (1280px) on every surface, same
 *    metrics as MarketingNav (`h-16`), so the logo never jumps between pages.
 *    Below `md` the header collapses nav + actions behind a hamburger — see
 *    app-header.tsx (server half, keeps `linkComponent={Link}` RSC-safe) and
 *    app-header-chrome.tsx (client half: hamburger state + panel).
 *  - Content spans the SAME container as the header (`default`) so pages use
 *    the full frame width; inside it, pages arrange cards/lists in grids and
 *    cap form fields at readable widths. `focused` (max-w-3xl) is for guided
 *    step flows (booking funnel, agent visit); `narrow` (max-w-md) for auth
 *    forms and small utility screens.
 *  - Vertical rhythm is fixed: `py-10` page padding, `gap-6` between blocks.
 */

export { AppHeader, type AppHeaderProps, type AppNavLink } from "./app-header";

/**
 * Each entry owns its horizontal box completely — including whether it uses
 * `container` at all. `full` deliberately does not: `container` caps at 1280px,
 * so a "full" width that kept it was only ever an alias of `default`, which is
 * what it used to be. Dense operational tables genuinely want the viewport.
 */
const CONTENT_WIDTHS = {
  /** Post-login pages: same container width as the header chrome. */
  default: "container",
  /** Guided step flows — booking funnel, agent visit — keep a focused column. */
  focused: "container max-w-3xl",
  /** Auth forms and small utility screens. */
  narrow: "container max-w-md",
  /**
   * Full-bleed, for dense tables where every column matters more than the
   * centered rhythm. Keeps the container's 1.5rem gutters so content never
   * touches the viewport edge, but drops the 1280px cap.
   */
  full: "w-full px-6",
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
      className={cn("flex flex-col gap-6 py-10", CONTENT_WIDTHS[width], className)}
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
    <footer className={cn("pb-10", CONTENT_WIDTHS[width], className)}>
      <div className="border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </footer>
  );
}

export { ContentColumn, AppFooter };
