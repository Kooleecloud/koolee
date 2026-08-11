import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AppHeader, Button, Toaster } from "@koolee/ui";

import { signOutStaff } from "@/actions/auth";
import { getAdminSession } from "@/lib/session";

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
  { href: "/blocks", label: "Blocks" },
  { href: "/zones", label: "Zones" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/staff", label: "Staff" },
] as const;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Session-aware chrome: the sign-out control lives in the header (folds
  // into the hamburger on mobile), not buried in a page body. Null on the
  // login/reset screens, so no button shows there.
  const session = await getAdminSession();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <AppHeader
          linkComponent={Link}
          links={[...NAV]}
          tag="ops"
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
        <Toaster />
      </body>
    </html>
  );
}
