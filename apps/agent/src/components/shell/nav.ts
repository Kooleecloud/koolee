import { CalendarDays, CircleUser, Navigation, type LucideIcon } from "lucide-react";

/**
 * The agent app's navigation — three tabs, at the bottom.
 *
 * Until now this app had NO navigation at all: the header carried a logo and
 * a Sign out button, `/scan` was reachable only by typing the URL, and the
 * most prominent control on every screen was the one that ends the session.
 *
 * Bottom rather than top because of who holds the phone. This is used
 * one-handed, outdoors, often while carrying something — the bottom third of
 * the screen is the only part a thumb reaches without regripping. The same
 * reasoning is why the tab bar sits above the home indicator rather than
 * behind it (see `env(safe-area-inset-bottom)` in globals.css).
 *
 * Three is the ceiling on purpose. A driver has exactly three questions:
 * what am I doing now, what is coming, and who am I signed in as.
 */
export interface AgentTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matches child routes too — a visit page keeps Today lit. */
  match: (pathname: string) => boolean;
}

export const AGENT_TABS: readonly AgentTab[] = [
  {
    href: "/",
    label: "Today",
    icon: Navigation,
    match: (p) => p === "/" || p.startsWith("/tasks/"),
  },
  {
    href: "/tasks",
    label: "Schedule",
    icon: CalendarDays,
    match: (p) => p === "/tasks",
  },
  {
    href: "/account",
    label: "Account",
    icon: CircleUser,
    match: (p) => p.startsWith("/account"),
  },
] as const;
