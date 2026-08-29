import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppHeader, Button, Toaster } from "@koolee/ui";
import { brandFontClassName } from "@koolee/ui/fonts";

import { signOutStaff } from "@/actions/auth";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Session-aware chrome: with no nav links the header renders no hamburger,
  // so the sign-out stays inline next to the logo at every width. Null on
  // the login/reset screens, so no button shows there.
  const session = await getAgentSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${brandFontClassName} min-h-dvh`}>
        <AppHeader
          linkComponent={Link}
          tag="agent"
          actions={
            session ? (
              <form action={signOutStaff}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            ) : undefined
          }
        />
        {children}
        <ServiceWorkerRegistrar />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
