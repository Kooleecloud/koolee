export { ConsoleChrome, type ConsoleChromeProps } from "./console-chrome";
export { ConsoleMain, type ConsoleMainProps } from "./console-main";
export {
  CONSOLE_NAV,
  resolveConsoleRoute,
  type ConsoleBadgeCounts,
  type ConsoleNavGroup,
  type ConsoleNavItem,
  type ConsoleRoute,
} from "./nav";
export {
  CONSOLE_HOME_OPTIONS,
  CONSOLE_PREFERENCES_COOKIE,
  CONSOLE_PREFERENCES_MAX_AGE,
  DEFAULT_CONSOLE_PREFERENCES,
  parseConsolePreferences,
  serializeConsolePreferences,
  type ConsoleDensity,
  type ConsolePreferences,
} from "./preferences";
export { useConsolePreferences } from "./preferences-context";
export { ConsoleBoardSkeleton, ConsoleSplitSkeleton } from "./console-skeletons";
