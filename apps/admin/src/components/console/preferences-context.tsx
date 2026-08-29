"use client";

import * as React from "react";

import {
  CONSOLE_PREFERENCES_COOKIE,
  CONSOLE_PREFERENCES_MAX_AGE,
  DEFAULT_CONSOLE_PREFERENCES,
  serializeConsolePreferences,
  type ConsolePreferences,
} from "./preferences";

interface ConsolePreferencesValue {
  preferences: ConsolePreferences;
  update: (patch: Partial<ConsolePreferences>) => void;
}

const ConsolePreferencesContext = React.createContext<ConsolePreferencesValue | null>(
  null,
);

/**
 * Applies a preference to the live document immediately, then persists it.
 *
 * The DOM write is what makes a toggle feel instant: `data-density` lives on
 * `<body>` (stamped server-side from the cookie, so the first paint is
 * already correct) and the CSS in globals.css keys off it, so flipping the
 * attribute re-lays the board out with no round-trip and no re-render of the
 * server-rendered table.
 */
function applyToDocument(preferences: ConsolePreferences): void {
  const { body } = document;
  body.dataset.density = preferences.density;
  body.dataset.consoleRail = preferences.railCollapsed ? "collapsed" : "expanded";
}

function persist(preferences: ConsolePreferences): void {
  document.cookie = [
    `${CONSOLE_PREFERENCES_COOKIE}=${serializeConsolePreferences(preferences)}`,
    "path=/",
    `max-age=${CONSOLE_PREFERENCES_MAX_AGE}`,
    "samesite=lax",
  ].join("; ");
}

export function ConsolePreferencesProvider({
  initial,
  children,
}: {
  /** Parsed from the cookie in the root layout, so SSR and the client agree. */
  initial: ConsolePreferences;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = React.useState(initial);

  const update = React.useCallback((patch: Partial<ConsolePreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      applyToDocument(next);
      persist(next);
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ preferences, update }), [preferences, update]);

  return (
    <ConsolePreferencesContext.Provider value={value}>
      {children}
    </ConsolePreferencesContext.Provider>
  );
}

/**
 * Read the operator's preferences.
 *
 * Falls back to the defaults outside a provider rather than throwing:
 * `ViewerLocalTime` is also rendered on surfaces that have no console chrome,
 * and a missing provider should cost a preference, not the page.
 */
export function useConsolePreferences(): ConsolePreferencesValue {
  const context = React.useContext(ConsolePreferencesContext);
  return (
    context ?? {
      preferences: DEFAULT_CONSOLE_PREFERENCES,
      update: () => {},
    }
  );
}
