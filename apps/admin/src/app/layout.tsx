import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppHeader, Toaster } from "@koolee/ui";

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
        <AppHeader linkComponent={Link} links={[...NAV]} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
