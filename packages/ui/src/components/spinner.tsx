import * as React from "react";

import { cn } from "../lib/utils";

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  /** Screen-reader label. Omit when a visible label sits next to the spinner. */
  label?: string;
}

/**
 * Minimal progress spinner. Inherits `currentColor` so it works inside any
 * button variant; sized by the parent's `[&_svg]:size-4` rule or `className`.
 */
function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn("animate-spin", className)}
        {...props}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          className="opacity-25"
        />
        <path
          fill="currentColor"
          className="opacity-75"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

export { Spinner };
