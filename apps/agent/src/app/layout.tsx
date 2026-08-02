import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppHeader, Toaster } from "@koolee/ui";

import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <AppHeader linkComponent={Link} />
        {children}
        <ServiceWorkerRegistrar />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
