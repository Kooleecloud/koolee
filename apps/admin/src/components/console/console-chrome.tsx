"use client";

import * as React from "react";
import { cn } from "@koolee/ui";

import { ConsoleRail } from "./console-rail";
import { ConsoleSettings } from "./console-settings";
import { ConsoleTopbar } from "./console-topbar";
import { ConsolePreferencesProvider, useConsolePreferences } from "./preferences-context";
import type { ConsolePreferences } from "./preferences";
import type { ConsoleBadgeCounts } from "./nav";

export interface ConsoleChromeProps {
  email: string | null;
  /** Display name, preferred over the email wherever both would fit. */
  fullName: string | null;
  /** Signed avatar URL, or null for the initials fallback. */
  avatarUrl: string | null;
  counts: ConsoleBadgeCounts;
  /** Shown outside production only. */
  environmentLabel?: string;
  /** `EnvStatus`, pre-rendered on the server. */
  diagnostics?: React.ReactNode;
  /** Parsed from the cookie in the root layout — the first paint is correct. */
  preferences: ConsolePreferences;
  children: React.ReactNode;
}

/**
 * Everything that is not the page: rail, top bar, settings sheet, and the
 * frame the page sits in.
 *
 * One client component owns the three pieces of chrome state — rail
 * collapsed, drawer open, settings open — because they are genuinely shared:
 * the drawer's trigger is in the top bar and its panel is the rail, and the
 * frame's left padding has to track the rail's width. Splitting them would
 * mean lifting the same state into a context that only these three
 * components read.
 *
 * `children` is the server-rendered page, passed straight through. Server
 * components crossing a client boundary as a prop stay server-rendered, so
 * nothing on a page is dragged into the client bundle by this wrapper.
 */
function ConsoleFrame({
  email,
  fullName,
  avatarUrl,
  counts,
  environmentLabel,
  diagnostics,
  children,
}: Omit<ConsoleChromeProps, "preferences">) {
  const { preferences, update } = useConsolePreferences();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);
  const collapsed = preferences.railCollapsed;

  return (
    <>
      <ConsoleRail
        counts={counts}
        home={preferences.home}
        collapsed={collapsed}
        onToggleCollapsed={() => update({ railCollapsed: !collapsed })}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
      />

      <div
        className={cn(
          "flex min-h-dvh flex-col transition-[padding] duration-200 ease-out-expo",
          "motion-reduce:transition-none",
          collapsed ? "lg:pl-17" : "lg:pl-64",
        )}
      >
        <ConsoleTopbar
          email={email}
          fullName={fullName}
          avatarUrl={avatarUrl}
          environmentLabel={environmentLabel}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {children}
      </div>

      <ConsoleSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        email={email}
        fullName={fullName}
        avatarUrl={avatarUrl}
        diagnostics={diagnostics}
      />
    </>
  );
}

export function ConsoleChrome({ preferences, ...props }: ConsoleChromeProps) {
  return (
    <ConsolePreferencesProvider initial={preferences}>
      <ConsoleFrame {...props} />
    </ConsolePreferencesProvider>
  );
}
