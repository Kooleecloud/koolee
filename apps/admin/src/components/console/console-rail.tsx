"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, X } from "lucide-react";
import { cn, KooleeLogo } from "@koolee/ui";

import { CONSOLE_NAV, resolveConsoleRoute, type ConsoleBadgeCounts } from "./nav";

export interface ConsoleRailProps {
  /** Live counts for the badged items. Zero counts render nothing. */
  counts: ConsoleBadgeCounts;
  /** Where the wordmark points — an operator preference. */
  home: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Below `lg` the rail is an off-canvas drawer instead of a fixed column. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

/**
 * The console's primary navigation.
 *
 * Two widths, one component: a 16rem column with labels, and a 4.25rem icon
 * column. Collapsing is a `lg:` concern only — below that breakpoint the rail
 * is a drawer, which is always full width because an icon-only drawer would
 * be a worse version of the thing it replaced.
 *
 * The active section is read from the pathname rather than passed down, so a
 * booking detail still lights up Bookings (see `resolveConsoleRoute`).
 */
export function ConsoleRail({
  counts,
  home,
  collapsed,
  onToggleCollapsed,
  drawerOpen,
  onCloseDrawer,
}: ConsoleRailProps) {
  const pathname = usePathname();
  const active = resolveConsoleRoute(pathname);

  // Navigating from inside the drawer should close it — otherwise the panel
  // sits over the page the operator just asked for.
  React.useEffect(() => {
    onCloseDrawer();
  }, [pathname, onCloseDrawer]);

  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
      {/* Scrim, drawer only. `lg:hidden` rather than unmounting, so the
          fade-out is not cut short by the element disappearing. */}
      <div
        aria-hidden="true"
        onClick={onCloseDrawer}
        className={cn(
          "fixed inset-0 z-40 bg-navy-950/40 transition-opacity duration-200 lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        aria-label="Console sections"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card",
          "transition-[transform,width] duration-200 ease-out-expo",
          "motion-reduce:transition-none",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
          collapsed ? "lg:w-17" : "lg:w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-border px-4",
            collapsed && "lg:justify-center lg:px-2",
          )}
        >
          <Link
            href={home}
            aria-label="Koolee Ops home"
            className="inline-flex min-w-0 items-center rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {/* Two logos rather than one conditional render: the wordmark is
                right for the 16rem rail and for the drawer at every width,
                and the glyph is right for the icon column. Swapping with
                `lg:` keeps the drawer correct on a phone regardless of the
                operator's desktop rail preference. */}
            <span
              className={cn("inline-flex items-center gap-2", collapsed && "lg:hidden")}
            >
              <KooleeLogo />
              <span className="rounded-sm bg-navy-50 px-1.5 py-0.5 text-[11px] font-semibold tracking-wider text-navy-700 uppercase">
                ops
              </span>
            </span>
            <span className={cn("hidden", collapsed && "lg:inline-flex")}>
              <KooleeLogo withWordmark={false} />
            </span>
          </Link>

          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="Close menu"
            className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-md text-navy-800 transition-colors hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
          {CONSOLE_NAV.map((group, groupIndex) => (
            <div
              key={group.caption}
              className={cn(
                groupIndex > 0 && "mt-5",
                // Collapsed, the captions are gone, so the grouping has to be
                // carried by a rule instead — otherwise seven icons read as
                // one undifferentiated stack.
                groupIndex > 0 &&
                  collapsed &&
                  "lg:mt-2 lg:border-t lg:border-border lg:pt-2",
              )}
            >
              <p
                className={cn(
                  "mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
                  collapsed && "lg:hidden",
                )}
              >
                {group.caption}
              </p>

              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = active?.item.href === item.href;
                  const count = item.badge ? counts[item.badge] : 0;
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={item.description}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-navy-50 font-semibold text-navy-800"
                            : "font-medium text-navy-700 hover:bg-navy-50 hover:text-navy-900",
                          collapsed && "lg:justify-center lg:px-0",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "size-[18px] shrink-0",
                            isActive
                              ? "text-navy-700"
                              : "text-muted-foreground group-hover:text-navy-600",
                          )}
                        />
                        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
                          {item.label}
                        </span>

                        {count > 0 && (
                          <>
                            <span
                              className={cn(
                                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                                item.badge === "exceptionsOpen"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/15 text-warning-foreground",
                                collapsed && "lg:hidden",
                              )}
                            >
                              {count}
                            </span>
                            {/* Icon mode has no room for the number, but
                                losing the signal entirely is worse than
                                losing its precision. */}
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute top-1.5 right-1.5 hidden size-1.5 rounded-full",
                                item.badge === "exceptionsOpen"
                                  ? "bg-destructive"
                                  : "bg-warning",
                                collapsed && "lg:block",
                              )}
                            />
                            <span className="sr-only">
                              {count}{" "}
                              {item.badge === "exceptionsOpen"
                                ? "open"
                                : "needing an agent"}
                            </span>
                          </>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hidden shrink-0 border-t border-border p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors",
              "hover:bg-navy-50 hover:text-navy-800",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center px-0",
            )}
          >
            <PanelLeft className="size-[18px] shrink-0" aria-hidden="true" />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
