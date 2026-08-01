import * as React from "react";

import { cn } from "../lib/utils";

export interface KooleeLogoProps extends React.SVGProps<SVGSVGElement> {
  /** Render the wordmark next to the glyph. */
  withWordmark?: boolean;
}

/**
 * Placeholder brand mark — a suitcase glyph with a handle.
 * Swap for the real asset once brand design lands.
 */
function KooleeLogo({ className, withWordmark = true, ...props }: KooleeLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-7 w-7 text-primary"
        aria-hidden="true"
        {...props}
      >
        <path
          d="M12 7V5.5A2.5 2.5 0 0 1 14.5 3h3A2.5 2.5 0 0 1 20 5.5V7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="4"
          y="7"
          width="24"
          height="20"
          rx="4"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M11 13h10M11 18h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark ? (
        <span className="text-lg font-semibold tracking-tight">Koolee</span>
      ) : null}
      <span className="sr-only">Koolee</span>
    </span>
  );
}

export { KooleeLogo };
