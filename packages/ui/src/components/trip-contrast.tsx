import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "../lib/utils";

export interface TripContrastColumn {
  /** Small overline, e.g. "Getting to the airport today". */
  label: React.ReactNode;
  items: React.ReactNode[];
}

export interface TripContrastProps extends React.HTMLAttributes<HTMLDivElement> {
  before: TripContrastColumn;
  after: TripContrastColumn;
}

/**
 * Side-by-side "what changes" panel.
 *
 * The site's job is not to explain the service, it is to show the difference
 * the service makes — so this component states the trip twice and lets the
 * reader feel the gap. No numbers: nothing here is measured, and invented
 * minutes or dollars would be a fabricated statistic.
 *
 * The design does the arguing, not the colour: the "today" column is flat and
 * dashed (provisional, unresolved), the Koolee column is a real card with a sky
 * rule and lift. Tag orange stays out of it — that belongs to CTAs and seals.
 */
function TripContrast({ before, after, className, ...props }: TripContrastProps) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 sm:gap-5", className)} {...props}>
      <div className="rounded-2xl border border-dashed border-navy-200 p-6 sm:p-7">
        <p className="text-xs font-semibold tracking-[0.14em] text-navy-400 uppercase">
          {before.label}
        </p>
        <ul className="mt-5 flex flex-col divide-y divide-navy-100">
          {before.items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-3 py-3 text-sm leading-relaxed text-muted-foreground first:pt-0 last:pb-0"
            >
              <span
                aria-hidden="true"
                className="mt-2 block size-1.5 shrink-0 rounded-full bg-navy-200"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-lift sm:p-7">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-sky-400"
        />
        <p className="text-xs font-semibold tracking-[0.14em] text-sky-600 uppercase">
          {after.label}
        </p>
        <ul className="mt-5 flex flex-col divide-y divide-border">
          {after.items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-3 py-3 text-sm leading-relaxed font-medium text-navy-800 first:pt-0 last:pb-0"
            >
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-sky-600"
                strokeWidth={2.5}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { TripContrast };
