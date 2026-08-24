import * as React from "react";

import { cn } from "../lib/utils";

export interface StepCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** 1-based step number, rendered as a zero-padded index ("01"). */
  step: number;
  title: React.ReactNode;
  /**
   * Supporting line. Optional on purpose: the marketing steps are strongest as
   * a bare list of four, and a card with a title and no paragraph is a
   * deliberate layout here, not a missing prop.
   */
  body?: React.ReactNode;
  /** Illustration or icon slot shown above the title. */
  visual?: React.ReactNode;
}

/** One step of the Koolee journey — book, seal, ride, bag drop. */
function StepCard({ step, title, body, visual, className, ...props }: StepCardProps) {
  const bare = !body;
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-2xl border border-border",
        "bg-white p-6 shadow-lift transition-shadow duration-300 hover:shadow-lift-lg",
        bare ? "gap-6" : "gap-4",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
        {visual ? (
          <div
            aria-hidden="true"
            className={cn(
              "text-sky-600",
              // Without a paragraph the glyph carries the card, so it gets room.
              bare ? "[&_svg]:h-11 [&_svg]:w-auto" : "[&_svg]:h-8 [&_svg]:w-auto",
            )}
          >
            {visual}
          </div>
        ) : null}
        <span
          aria-hidden="true"
          className="font-display text-3xl leading-none font-semibold text-navy-100"
        >
          {String(step).padStart(2, "0")}
        </span>
      </div>
      <div className={cn("flex flex-col gap-1.5", bare && "mt-auto")}>
        <h3
          className={cn(
            "font-display font-semibold text-navy-800",
            bare ? "text-xl leading-snug" : "text-lg",
          )}
        >
          <span className="sr-only">Step {step}: </span>
          {title}
        </h3>
        {body ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        ) : null}
      </div>
    </div>
  );
}

export { StepCard };
