import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@koolee/ui";
import { brandFontClassName } from "@koolee/ui/fonts";

import { DevPanel } from "@/components/dev-panel";
import { optionalEnv } from "@/env";
import { SITE } from "@/lib/site";

import "./globals.css";

const appUrl = optionalEnv("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: SITE.title,
    template: SITE.titleTemplate,
  },
  description: SITE.description,
  openGraph: {
    siteName: SITE.name,
    type: "website",
    title: SITE.title,
    description: SITE.ogDescription,
  },
};

export const viewport: Viewport = {
  themeColor: "#0B2545",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior keeps Next 16 overriding our CSS smooth-scroll
    // during SPA navigations (instant scroll-to-top), as 15 did by default.
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${brandFontClassName} min-h-dvh`}>
        {children}
        <Toaster />
        <DevPanel />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
