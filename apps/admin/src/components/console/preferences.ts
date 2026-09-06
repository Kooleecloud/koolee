/**
 * Console preferences — the operator's display choices.
 *
 * Deliberately a cookie rather than `localStorage`: the root layout reads
 * them during SSR and stamps `data-density` / `data-console-rail` onto
 * `<body>`, so a compact board renders compact on the first paint. Read from
 * `localStorage` after hydration and every session would flash the default
 * layout first, which on a dense board is the whole page moving.
 *
 * Per browser, not per account — these are about the screen in front of the
 * operator (a laptop on a train wants a different rail than a 27" desk
 * monitor), so they do not belong on the staff record.
 *
 * No `"use client"` here on purpose: the parse/serialize pair runs on the
 * server (root layout) and on the client (the settings sheet). The React
 * context that carries the parsed value lives in `preferences-context.tsx`.
 */

export type ConsoleDensity = "comfortable" | "compact";

export interface ConsolePreferences {
  /** Table and list-row metrics. Compact fits roughly four more board rows. */
  density: ConsoleDensity;
  /**
   * Show the operator's own zone beside the airport time. The airport time
   * stays authoritative and always renders — see `viewer-local-time.tsx`.
   */
  viewerTime: boolean;
  /** Where the wordmark points. Some operators live on the board, not Overview. */
  home: string;
  /** Rail collapsed to an icon column. */
  railCollapsed: boolean;
}

export const CONSOLE_PREFERENCES_COOKIE = "koolee_admin_console";

/** A year — a display preference has no reason to expire on a working console. */
export const CONSOLE_PREFERENCES_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_CONSOLE_PREFERENCES: ConsolePreferences = {
  density: "comfortable",
  viewerTime: true,
  home: "/",
  railCollapsed: false,
};

/** The only values `home` may hold — an open redirect target is not a preference. */
export const CONSOLE_HOME_OPTIONS = [
  { value: "/", label: "Overview" },
  { value: "/bookings", label: "Bookings board" },
] as const;

/**
 * Defensive by design: this parses a cookie, which is user-writable. Anything
 * unrecognised falls back to the default for that one field rather than
 * throwing away the whole object — a hand-edited cookie should cost the
 * operator one preference, not their whole console.
 */
export function parseConsolePreferences(raw: string | undefined): ConsolePreferences {
  if (!raw) return DEFAULT_CONSOLE_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return DEFAULT_CONSOLE_PREFERENCES;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONSOLE_PREFERENCES;

  const value = parsed as Record<string, unknown>;
  const home = CONSOLE_HOME_OPTIONS.some((option) => option.value === value.home)
    ? (value.home as string)
    : DEFAULT_CONSOLE_PREFERENCES.home;

  return {
    density:
      value.density === "compact" || value.density === "comfortable"
        ? value.density
        : DEFAULT_CONSOLE_PREFERENCES.density,
    viewerTime:
      typeof value.viewerTime === "boolean"
        ? value.viewerTime
        : DEFAULT_CONSOLE_PREFERENCES.viewerTime,
    home,
    railCollapsed:
      typeof value.railCollapsed === "boolean"
        ? value.railCollapsed
        : DEFAULT_CONSOLE_PREFERENCES.railCollapsed,
  };
}

export function serializeConsolePreferences(preferences: ConsolePreferences): string {
  return encodeURIComponent(JSON.stringify(preferences));
}
