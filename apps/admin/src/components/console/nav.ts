import {
  CalendarOff,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MapPin,
  TriangleAlert,
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
