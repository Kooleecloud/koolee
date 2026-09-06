import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AppHeader, Toaster } from "@koolee/ui";
import { brandFontClassName } from "@koolee/ui/fonts";

import { ConsoleChrome } from "@/components/console";
import {
  CONSOLE_PREFERENCES_COOKIE,
  parseConsolePreferences,
} from "@/components/console";
import { EnvStatus } from "@/components/env-status";
import { isDev } from "@/env";
import { signAvatarUrl } from "@/lib/avatars";
import { getConsoleDashboard } from "@/lib/console-dashboard";
import { getAdminIdentity } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Koolee Ops",
    template: "%s · Koolee Ops",
  },
  description: "Operations console: routes, exceptions, manual overrides.",
};

export const viewport: Viewport = {
  themeColor: "#0B2545",
};

/**
 * Two frames, chosen by session.
 *
 * Signed in, the console gets its own chrome: a collapsible rail, a top bar,
 * and a settings sheet (`components/console`). Signed out — the login, reset
 * and set-password screens — it keeps the shared `AppHeader` with no links,
 * which is exactly what the agent app shows on the same screens. So the two
 * staff consoles still look like siblings at the door, and only the surface
 * with seven sections to navigate grows a rail.
 *
 * Preferences are read here rather than after hydration so `data-density` is
 * already on `<body>` for the first paint. A board that renders comfortable
 * and then re-lays-out compact is the whole page moving under the operator.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [identity, cookieStore] = await Promise.all([getAdminIdentity(), cookies()]);
  const preferences = parseConsolePreferences(
    cookieStore.get(CONSOLE_PREFERENCES_COOKIE)?.value,
  );

  // Only signed-in chrome shows counts, so signed-out requests never pay for
  // the query.
  const dashboard = identity ? await getConsoleDashboard() : null;

  // An admin is active staff, so their own session signs this under 0027's
  // read policy — no service-role client involved.
  const avatarUrl = identity ? await signAvatarUrl(identity.avatarStoragePath) : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${brandFontClassName} min-h-dvh`}
        data-density={preferences.density}
        data-console-rail={preferences.railCollapsed ? "collapsed" : "expanded"}
      >
        {identity ? (
          <ConsoleChrome
            email={identity.email}
            fullName={identity.fullName}
            avatarUrl={avatarUrl}
            counts={{
              unassignedToday: dashboard?.unassignedToday ?? 0,
              exceptionsOpen: dashboard?.exceptionsOpen ?? 0,
            }}
            environmentLabel={isDev ? "local" : undefined}
            diagnostics={<EnvStatus appName="admin" />}
            preferences={preferences}
          >
            {children}
          </ConsoleChrome>
        ) : (
          <div className="min-h-dvh">
            <AppHeader linkComponent={Link} tag="ops" />
            {children}
          </div>
        )}
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
