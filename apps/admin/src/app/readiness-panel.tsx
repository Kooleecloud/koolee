import Link from "next/link";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@koolee/ui";
import type { LaunchReadiness } from "@koolee/core";

/**
 * Whether Koolee can sell at all — and it deletes itself once it can.
 *
 * WHY IT IS HERE. Each of these is a condition under which the product stops
 * working with no error anywhere: no active pricing rule and every quote
 * refuses; no published agreement and every agent visit stops at a doorstep.
 * Before this, the console's only signal was `NoAgreementBanner`, which
 * covered exactly one of the four.
 *
 * WHY IT DISAPPEARS. A permanent all-green health panel is a block of page
 * that says "fine" forever, and a thing that always says fine is a thing
 * nobody reads — so on the day it matters it will not be read either. Rendered
 * only while something is unresolved; the moment every item is `ok` the block
 * is simply not there. `LAUNCH-CHECKLIST.md` remains the record of the whole
 * opening, including everything no query can see.
 *
 * The blocked items ALSO appear at the top of the page, in the attention
 * panel, and that repetition is deliberate: the attention panel is what you
 * act on today, and this is the progress bar toward opening.
 */
export function ReadinessPanel({ readiness }: { readiness: LaunchReadiness }) {
  if (readiness.ready) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">Before you can sell</CardTitle>
          <CardDescription>
            The four things the database can answer for itself. The rest of the opening
            lives in the launch checklist.
          </CardDescription>
        </div>
        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {readiness.okCount} of {readiness.items.length}
        </span>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {readiness.items.map((item) => (
            <li
              key={item.key}
              className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              {item.status === "ok" ? (
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-success"
                />
              ) : item.status === "blocked" ? (
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
              ) : (
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                />
              )}

              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm",
                    // A settled item is not news. It keeps its place so the
                    // list reads as a whole, and it stops asking for attention.
                    item.status === "ok" ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
                {item.detail ? (
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </span>

              {item.status === "ok" ? null : (
                <Link
                  href={item.href}
                  className="ml-auto shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Fix
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
