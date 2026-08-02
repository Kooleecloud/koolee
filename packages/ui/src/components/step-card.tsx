import * as React from "react";

import { cn } from "../lib/utils";

export interface StepCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** 1-based step number, rendered as a zero-padded index ("01"). */
  step: number;
  title: React.ReactNode;
  body: React.ReactNode;
  /** Illustration or icon slot shown above the title. */
  visual?: React.ReactNode;
}

/** One step of the Koolee journey — book, seal, ride, bag drop. */
function StepCard({ step, title, body, visual, className, ...props }: StepCardProps) {
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-4 rounded-2xl border border-border",
        "bg-white p-6 shadow-lift transition-shadow duration-300 hover:shadow-lift-lg",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
        {visual ? (
          <div aria-hidden="true" className="text-sky-600 [&_svg]:h-8 [&_svg]:w-auto">
            {visual}
          </div>
        ) : null}
        <span
          aria-hidden="true"
          className="font-display text-3xl font-semibold leading-none text-navy-100"
        >
          {String(step).padStart(2, "0")}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-lg font-semibold text-navy-800">
          <span className="sr-only">Step {step}: </span>
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export { StepCard };
