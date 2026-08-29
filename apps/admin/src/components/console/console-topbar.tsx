"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Menu, Search, Settings } from "lucide-react";
import { Avatar, cn, Input } from "@koolee/ui";

import { resolveConsoleRoute } from "./nav";

export interface ConsoleTopbarProps {
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** Rendered only outside production, where knowing the target matters. */
  environmentLabel?: string;
  onOpenDrawer: () => void;
  onOpenSettings: () => void;
}

/**
 * Two initials from an email local part — `ops@koolee.local` → `OP`.
 *
 * Kept for the email-only case. When a display name exists, `Avatar` derives
 * initials from THAT instead, so the console and the staff table agree on what
 * a person's two letters are.
 */
function emailInitialsFor(email: string | null): string {
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (local.slice(0, 2) || "??").toUpperCase();
}

/**
 * The console's top bar: where am I, find a booking, who am I, settings.
 *
 * The crumb trail stops at the section on purpose. On a booking detail the
 * section becomes a link back and the page's own `PageHeader` carries the
 * identity — the layout cannot know a booking's ref without the page handing
 * data upward, and `Bookings › Booking` would be a crumb that says nothing.
 */
export function ConsoleTopbar({
  email,
  fullName,
  avatarUrl,
  environmentLabel,
  onOpenDrawer,
  onOpenSettings,
}: ConsoleTopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const route = resolveConsoleRoute(pathname);

  const onSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const query = typeof value === "string" ? value.trim() : "";
    // Same param the board already reads, so the result is a shareable board
    // URL rather than a second, parallel search surface.
    router.push(query ? `/bookings?q=${encodeURIComponent(query)}` : "/bookings");
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open menu"
        className="-ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-navy-800 transition-colors hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-sm"
      >
        {route ? (
          <>
            <span className="hidden shrink-0 text-muted-foreground sm:inline">
              {route.group}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="hidden size-3.5 shrink-0 text-border sm:block"
            />
            {route.isDetail ? (
              <>
                <Link
                  href={route.item.href}
                  className="shrink-0 rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-navy-800 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {route.item.label}
                </Link>
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-border"
                />
                <span aria-current="page" className="truncate font-medium text-navy-800">
                  Detail
                </span>
              </>
            ) : (
              <span aria-current="page" className="truncate font-medium text-navy-800">
                {route.item.label}
              </span>
            )}
          </>
        ) : null}
      </nav>

      <form onSubmit={onSearch} className="relative hidden md:block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          name="q"
          type="search"
          placeholder="Ref, phone, or seal"
          aria-label="Find a booking by ref, phone number, or seal serial"
          className="w-56 pl-8 lg:w-64"
        />
      </form>

      {environmentLabel ? (
        <span
          title="Which environment this console is pointed at"
          className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:inline-flex"
        >
          <span aria-hidden="true" className="block size-1.5 rounded-full bg-success" />
          {environmentLabel}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-navy-800 transition-colors hover:bg-navy-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="size-[18px]" aria-hidden="true" />
      </button>

      {/* Identity, not a control — the gear beside it is the only way in, so
          there is one affordance for one destination. */}
      <div
        title={email ?? fullName ?? undefined}
        className="flex shrink-0 items-center gap-2 border-l border-border pl-3"
      >
        <Avatar
          size="sm"
          name={fullName ?? emailInitialsFor(email)}
          src={avatarUrl}
          alt=""
        />
        <span
          className={cn(
            "hidden max-w-44 truncate text-sm text-muted-foreground xl:inline",
            !email && !fullName && "xl:hidden",
          )}
        >
          {fullName ?? email}
        </span>
        <span className="sr-only">Signed in as {fullName ?? email ?? "an admin"}</span>
      </div>
    </header>
  );
}
