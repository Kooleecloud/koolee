import type { Metadata, Viewport } from "next";
import { Toaster } from "@koolee/ui";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Koolee — doorstep luggage pickup",
    template: "%s · Koolee",
  },
  description:
    "We pick your bags up at your door and deliver them to your airline's bag drop at JFK, LGA, or EWR.",
};

export const viewport: Viewport = {
  themeColor: "#0b3c8c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
