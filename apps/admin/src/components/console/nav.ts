import {
  BadgeDollarSign,
  CalendarOff,
  ClipboardList,
  Container,
  FileText,
  LayoutDashboard,
  MapPin,
  PlaneTakeoff,
  TriangleAlert,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The console's information architecture — the one place that knows what
 * sections exist and how they group.
 *
 * Until 2026-08-29 these were seven flat links in the shared `AppHeader`,
 * which is the marketing/in-app header all three apps share. Two problems
 * with that, both structural rather than cosmetic: the header has no room to
 * grow past about seven items, and a flat list hides that "what am I doing
 * today" (Operations) and "how is this console configured" (Configuration)
 * are different errands an operator is on at different times.
 *
 * The rail stays admin-only on purpose. `packages/ui/DESIGN.md`: a pattern is
 * promoted into the shared package when two or more apps repeat it, and web
 * and agent both still want the header — web's dashboard has two links and
 * agent's console has none, so neither has a rail's worth of navigation.
 */

/** Which live count, if any, rides on a nav item. Keys of `ConsoleBadgeCounts`. */
export type ConsoleBadgeKey = "unassignedToday" | "exceptionsOpen";

/**
 * What each badge's number MEANS, in a phrase that finishes "3 …".
 *
 * IT LIVES HERE BECAUSE IT WAS A TERNARY IN THE RAIL, and that ternary knew
 * about two of the three badges then present: `exceptionsOpen` said "open" and
 * EVERYTHING ELSE said "needing an agent". So the Shifts badge — which counted
 * sealed bookings with no DRIVER — was announced to a screen reader as "2
 * needing an agent", a different problem on a different page. That badge has
 * since been removed outright; the rule it exposed has not.
 *
 * A record keyed by the badge type means a new badge cannot be added without
 * a phrase: the compiler asks for one. That is the whole reason it is a
 * `Record` and not a lookup with a fallback.
 */
export const CONSOLE_BADGE_MEANING: Record<ConsoleBadgeKey, string> = {
  unassignedToday: "needing an agent",
  exceptionsOpen: "stopped and open",
};

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * One line on what the section is for. Becomes the item's `title` so it is
   * reachable when the rail is collapsed to icons and the label is gone.
   */
  description: string;
  badge?: ConsoleBadgeKey;
}

export interface ConsoleNavGroup {
  caption: string;
  items: readonly ConsoleNavItem[];
}

/**
 * The two counts the rail can surface. Both already exist on `OpsDashboard`
 * — the rail shows numbers ops was previously only shown after navigating to
 * the landing page, it does not compute new ones.
 */
export interface ConsoleBadgeCounts {
  unassignedToday: number;
  exceptionsOpen: number;
}

/*
 * `awaitingDriverToday` is deliberately NOT here any more — sealed bookings
 * today with no driver. The metric is alive and well on the Overview
 * dashboard, where it counts something the page it sits on actually lists;
 * it is only no longer a rail badge. See the note on the Shifts item.
 */

export const CONSOLE_NAV: readonly ConsoleNavGroup[] = [
  {
    caption: "Operations",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: LayoutDashboard,
        description: "Today's numbers and what needs a human",
      },
      {
        href: "/bookings",
        label: "Bookings",
        icon: ClipboardList,
        description: "The dispatch board, by pickup window",
        badge: "unassignedToday",
      },
      {
        href: "/shifts",
        label: "Shifts",
        icon: Truck,
        description: "Who is out driving, in what, with how many bags",
        /*
         * NO BADGE HERE, and it is worth saying why rather than looking like
         * an omission. `awaitingDriverToday` used to ride on this item. The
         * count is real and still on the Overview dashboard — sealed bookings
         * today with no driver — but it counts BOOKINGS while this page lists
         * SHIFTS, so clicking it never showed the things it counted.
         *
         * It was placed here by CAUSE (nobody eligible is clocked on, and this
         * is where you fix that) rather than by subject, which made it the odd
         * one of the three: `unassignedToday` and `exceptionsOpen` both sit on
         * the page that lists what they count.
         *
         * It is also the one badge whose likeliest explanation needs no action
         * at all — the customer simply has not chosen their driver yet — so a
         * standing number here trained an operator to ignore a badge, which is
         * the opposite of what a badge is for. TD's call, 2026-08-31.
         */
      },
      {
        href: "/exceptions",
        label: "Exceptions",
        icon: TriangleAlert,
        description: "Bookings that stopped on their normal path",
        badge: "exceptionsOpen",
      },
    ],
  },
  {
    caption: "Configuration",
    items: [
      {
        href: "/pricing",
        label: "Pricing",
        icon: BadgeDollarSign,
        description: "What a booking costs, and the lead-time curve",
      },
      {
        href: "/cutoffs",
        label: "Airline cutoffs",
        icon: PlaneTakeoff,
        description: "How late each airline takes bags — every window depends on it",
      },
      {
        href: "/blocks",
        label: "Window blocks",
        icon: CalendarOff,
        description: "Hide pickup windows from customers",
      },
      {
        href: "/zones",
        label: "Agent zones",
        icon: MapPin,
        description: "ZIP coverage that auto-assign picks from",
      },
      {
        href: "/agreements",
        label: "Agreements",
        icon: FileText,
        description: "Versioned booking agreements",
      },
      {
        href: "/trucks",
        label: "Trucks",
        icon: Container,
        description: "The fleet and how many bags each one holds",
      },
      {
        href: "/staff",
        label: "Staff",
        icon: Users,
        description: "Invite agents and admins, revoke access",
      },
    ],
  },
] as const;

/** Every nav item, flattened — for lookups that do not care about grouping. */
const FLAT_ITEMS: readonly { group: string; item: ConsoleNavItem }[] =
  CONSOLE_NAV.flatMap((group) =>
    group.items.map((item) => ({ group: group.caption, item })),
  );

export interface ConsoleRoute {
  group: string;
  item: ConsoleNavItem;
  /**
   * True on a child route — a booking detail. The section crumb becomes a
   * link back rather than the current position.
   *
   * The crumb trail deliberately stops at the section: a detail page's own
   * identity (`UA1189 · EWR`, ref `K7F2A9`) is already the `PageHeader`, and
   * the layout cannot know it without the page passing data upward.
   */
  isDetail: boolean;
}

/**
 * Which section a pathname belongs to.
 *
 * Longest-prefix wins so `/bookings/<id>` resolves to Bookings rather than to
 * Overview, whose `/` prefixes everything. Unknown paths return null and the
 * chrome renders without a trail rather than guessing.
 */
export function resolveConsoleRoute(pathname: string): ConsoleRoute | null {
  const exact = FLAT_ITEMS.find(({ item }) => item.href === pathname);
  if (exact) return { ...exact, isDetail: false };

  const nested = FLAT_ITEMS.filter(
    ({ item }) => item.href !== "/" && pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.item.href.length - a.item.href.length)[0];

  return nested ? { ...nested, isDetail: true } : null;
}
