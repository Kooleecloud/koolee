import * as React from "react";

import { cn } from "../lib/utils";

export interface StatBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small leading icon, typically a lucide icon sized by the parent. */
  icon?: React.ReactNode;
  /** The claim, e.g. "Serialized seals". Keep it factual — no invented numbers. */
  label: React.ReactNode;
  /** Optional supporting detail rendered after the label. */
  description?: React.ReactNode;
}

/**
 * A quiet proof chip for process facts (seals, photo proof, live tracking).
 * Trust at Koolee is built with process transparency, not fabricated stats —
 * use these for what we do, never for made-up counts.
 */
function StatBadge({ icon, label, description, className, ...props }: StatBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-border",
        "bg-white px-4 py-2 text-sm text-navy-800 shadow-sm",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="text-sky-600 [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="font-medium">{label}</span>
      {description ? <span className="text-muted-foreground">{description}</span> : null}
    </div>
  );
}

export { StatBadge };
