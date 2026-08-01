import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { KooleeLogo, Toaster } from "@koolee/ui";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Koolee Ops",
    template: "%s · Koolee Ops",
  },
  description: "Operations console: routes, exceptions, manual overrides.",
};

export const viewport: Viewport = {
  themeColor: "#0b3c8c",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/bookings", label: "Bookings" },
  { href: "/exceptions", label: "Exceptions" },
] as const;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <div className="border-b">
          <div className="container flex h-14 items-center gap-6">
            <Link href="/">
              <KooleeLogo />
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
