"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@koolee/ui";

import { AGENT_TABS } from "./nav";

/**
 * The bottom tab bar.
 *
 * Metrics are set by the hand, not by the type scale: each tab is a 56px-tall
 * target spanning a third of the viewport, which clears the 44px minimum with
 * room for a glove and a moving vehicle. Labels stay visible — an icon-only
 * bar saves nothing here and costs a driver a guess.
 */
export function AgentTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg">
        {AGENT_TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2",
                  active ? "text-navy-800" : "text-muted-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-6", active && "text-navy-800")}
                  strokeWidth={active ? 2.4 : 2}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
