"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@koolee/ui";

/**
 * Wraps the funnel step content and, on desktop, adds a left rail summarising
 * what the customer has already entered — so checking an earlier answer never
 * requires walking backwards. Data comes precomputed from the layout (which
 * re-renders on every draft write); the rail decides visibility from the URL:
 * hidden on Review & pay and verify (that page IS the summary), off-funnel
 * pages, and any step with nothing entered yet. The section belonging to the
 * step currently on screen is omitted — its form already shows the values.
 */

export interface BookingSummaryData {
  flight: { flight: string; departure: string; pax: string } | null;
  pickup: { address: string; bags: string } | null;
  window: string | null;
}

const RAIL_PATHS = ["/book/flight", "/book/pickup", "/book/slot"];

export function BookingSummaryShell({
  summary,
  children,
}: {
  summary: BookingSummaryData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const sections: Array<{ href: string; label: string; lines: string[] }> = [];
  if (summary.flight) {
    sections.push({
      href: "/book/flight",
      label: "Flight",
      lines: [summary.flight.flight, summary.flight.departure, summary.flight.pax],
    });
  }
  if (summary.pickup) {
    sections.push({
      href: "/book/pickup",
      label: "Pickup",
      lines: [summary.pickup.address, summary.pickup.bags],
    });
  }
  if (summary.window) {
    sections.push({ href: "/book/slot", label: "Window", lines: [summary.window] });
  }

  const visible = sections.filter((section) => !pathname.startsWith(section.href));

  const onRailStep = RAIL_PATHS.some((path) => pathname.startsWith(path));
  if (!onRailStep || visible.length === 0) {
    return <>{children}</>;
  }

  return (
    <div className="lg:container lg:grid lg:max-w-5xl lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
      <aside
        className="sticky top-6 hidden pt-10 lg:block"
        aria-label="Your booking so far"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your booking so far</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {visible.map((section) => (
              <div key={section.href} className="flex flex-col gap-0.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-navy-800">{section.label}</span>
                  <Link
                    href={section.href}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Edit
                  </Link>
                </div>
                {section.lines.filter(Boolean).map((line, i) => (
                  <span key={i} className="text-muted-foreground">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
