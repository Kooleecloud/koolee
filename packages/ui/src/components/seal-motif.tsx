import * as React from "react";

import { cn } from "../lib/utils";

export interface SealMotifProps extends React.SVGProps<SVGSVGElement> {
  /** Serial printed on the seal. Real seals are serialized; the motif shows it. */
  serial?: string;
  /**
   * Accessible label. Pass null to mark the motif decorative (aria-hidden)
   * when adjacent text already tells the seal story.
   */
  label?: string | null;
}

/**
 * The Koolee seal: an orange tamper-evident tag with a serial number.
 * This is the one place outside CTAs where tag orange may appear — it *is*
 * the seal, not decoration.
 */
function SealMotif({
  serial = "NYC 000481",
  label = "Tamper-evident Koolee seal",
  className,
  ...props
}: SealMotifProps) {
  return (
    <svg
      viewBox="0 0 160 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-16 w-auto", className)}
      {...(label === null
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
      {...props}
    >
      {/* Strap looping through the eyelet */}
      <path
        d="M22 36c-9 0-16-7-16-14s6-12 12-12 11 5 11 11"
        stroke="#0B2545"
        strokeOpacity="0.45"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Tag body — rounded tab end, like the CTA button */}
      <path
        d="M36 12h104a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10H36
           a24 24 0 0 1 0-48Z"
        fill="#FF6B35"
      />
      {/* Eyelet */}
      <circle cx="30" cy="36" r="6" fill="#F8F9FB" />
      <circle cx="30" cy="36" r="6" stroke="#0B2545" strokeOpacity="0.35" strokeWidth="2.5" />
      {/* Print: wordmark + serial */}
      <text
        x="52"
        y="34"
        fill="#0B2545"
        fontSize="12"
        fontWeight="700"
        letterSpacing="1.5"
        fontFamily="var(--font-display), system-ui, sans-serif"
      >
        KOOLEE
      </text>
      <text
        x="52"
        y="51"
        fill="#0B2545"
        fillOpacity="0.75"
        fontSize="10"
        fontWeight="600"
        letterSpacing="2"
        fontFamily="var(--font-mono), ui-monospace, monospace"
      >
        {serial}
      </text>
      {/* Perforation line — tears visibly if tampered with */}
      <line
        x1="136"
        y1="16"
        x2="136"
        y2="56"
        stroke="#0B2545"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="2 4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { SealMotif };
