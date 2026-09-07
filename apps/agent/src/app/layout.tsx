import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AppHeader, Toaster } from "@koolee/ui";
import { brandFontClassName } from "@koolee/ui/fonts";

import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { AgentTabBar } from "@/components/shell/agent-tab-bar";
import { ShiftLocation } from "@/components/shift/shift-location";
import { getAgentSession } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Koolee Agent",
    template: "%s · Koolee Agent",
  },
  description: "Check-in agent and driver console for Koolee.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Koolee Agent",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B2545",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * The agent shell: a slim header and a bottom tab bar.
 *
 * Two changes from what this app had, both about who is holding the phone.
 *
 * There was no navigation at all — `/scan` could only be reached by typing
 * the URL — and the single most prominent control on every screen was Sign
 * out, sitting in the top-right corner where a thumb lands. Sign out now
 * lives on the Account tab, which is where someone goes deliberately rather
 * than by accident at the end of a shift.
 *
 * The header keeps only the wordmark: on a 393px screen, chrome is space
 * taken from the job. Every screen names itself in its own heading, so a
 * title in the bar would say it twice.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAgentSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${brandFontClassName} min-h-dvh`}>
        {/*
          THE TWO STATUS PILLS LIVE IN THE HEADER, not in the page.

          POSITION IS A FACT ABOUT THE DRIVER, NOT ABOUT THE SCREEN.
          `GpsPinger` used to live on the Today page alone, so opening a task —
          the moment somebody is most likely to be moving — stopped reporting,
          silently, and the customer's map went quiet. In the shell it runs
          from every page for as long as the shift is open.

          It then rendered its status in the page BODY, which had the same
          shape of problem one level up: a driver deep in a task could not see
          whether Koolee was seeing them, or even whether they were clocked
          on. Both answers now sit in the header, on every screen, with their
          detail behind a tap. Off the clock this renders nothing and touches
          no geolocation API at all.

          `sticky` stays false: on a 393px screen a pinned bar is space taken
          from the job, and the pills are one scroll away rather than absent.
        */}
        <AppHeader
          linkComponent={Link}
          tag="agent"
          sticky={false}
          actions={session ? <ShiftLocation /> : undefined}
        />
        {children}
        {session ? <AgentTabBar /> : null}
        <ServiceWorkerRegistrar />
        <Toaster position="top-center" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
