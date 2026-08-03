import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { Toaster } from "@koolee/ui";

import { DevPanel } from "@/components/dev-panel";
import { optionalEnv } from "@/env";
import { SITE } from "@/lib/site";

import "./globals.css";

/**
 * Type system: Sora for display (geometric, airline-signage confidence),
 * Inter for body (quiet, highly readable). The CSS variables feed the
 * `font-display` / `font-sans` families in the shared Tailwind preset.
 */
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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
      <body className={`${sora.variable} ${inter.variable} min-h-dvh font-sans`}>
        {children}
        <Toaster />
        <DevPanel />
      </body>
    </html>
  );
}
