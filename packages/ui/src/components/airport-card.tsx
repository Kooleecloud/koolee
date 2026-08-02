import * as React from "react";
import { Clock } from "lucide-react";

import { cn } from "../lib/utils";

export interface AirportCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** IATA code, e.g. "JFK". */
  code: string;
  name: React.ReactNode;
  body: React.ReactNode;
  /** Cutoff/timing note rendered with a clock icon. */
  note?: React.ReactNode;
}

/** Coverage card for one airport, led by the code like a departure board. */
function AirportCard({ code, name, body, note, className, ...props }: AirportCardProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 rounded-2xl border border-border bg-white p-6",
        "shadow-lift transition-shadow duration-300 hover:shadow-lift-lg",
        className,
      )}
      {...props}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-display text-4xl font-semibold tracking-tight text-navy-800">
          {code}
        </span>
        <span className="text-sm font-medium text-sky-600">{name}</span>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {note ? (
        <p className="flex items-start gap-2 border-t border-border pt-4 text-xs text-navy-600">
          <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-sky-600" />
          <span>{note}</span>
        </p>
      ) : null}
    </div>
  );
}

export { AirportCard };
