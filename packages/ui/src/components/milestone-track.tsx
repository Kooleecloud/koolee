import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "../lib/utils";

export interface MilestoneTrackProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** In order, earliest first. The last stop is rendered as the destination. */
  items: string[];
  /** Overline above the track. */
  label?: React.ReactNode;
}

/**
 * A progression, drawn like an itinerary.
 *
 * Used for founder bios: a list of roles reads as a résumé, whereas the same
 * facts routed left-to-right read as a trajectory that lands on Koolee. The
 * mono type and chevrons are the airport-departure-board vocabulary the rest of
 * the site already speaks (see `AirportCard`), so it needs no explaining.
 */
function MilestoneTrack({ items, label, className, ...props }: MilestoneTrackProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      {label ? (
        <p className="text-[0.6875rem] font-semibold tracking-[0.16em] text-navy-400 uppercase">
          {label}
        </p>
      ) : null}
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item}-${i}`} className="flex items-center gap-1">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] leading-none tracking-[0.06em] uppercase",
                  isLast
                    ? "border-navy-800 bg-navy-800 font-semibold text-white"
                    : "border-border bg-navy-50 text-navy-600",
                )}
              >
                {item}
              </span>
              {!isLast ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-navy-300"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export { MilestoneTrack };
