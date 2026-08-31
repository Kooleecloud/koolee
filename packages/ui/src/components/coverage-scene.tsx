import * as React from "react";

import { cn } from "../lib/utils";

const NAVY = "#0B2545";
const NAVY_SOFT = "#B4C5DE";
const SKY = "#38B6E3";
const SKY_SOFT = "#AEE2F5";
const TAG = "#FF6B35";

/** Airport node centres, top to bottom. The service area is exactly three. */
const NODES = [
  { cy: 66, arc: "M148 158 C 226 104, 288 74, 356 66" },
  { cy: 170, arc: "M150 170 C 236 172, 288 170, 356 170" },
  { cy: 274, arc: "M148 182 C 226 236, 288 266, 356 274" },
] as const;

export interface CoverageSceneProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Airport codes, rendered top to bottom. A fixed-length tuple because the
   * arcs are drawn, not computed — Koolee serves exactly three airports, and a
   * fourth should be a deliberate redraw rather than a silently dropped item.
   */
  airports: readonly [string, string, string];
  caption?: React.ReactNode;
}

/**
 * Coverage diagram: one doorstep, three bag drops.
 *
 * Replaces a "map coming soon" placeholder. It is deliberately a schematic and
 * says so in its caption — a stylised NYC outline would imply geographic
 * precision we are not drawing, and an unfinished-looking dashed box on a
 * launch page costs more trust than a map buys.
 *
 * Legible-at-any-width rule (same as `HeroRouteScene`): only the airport codes
 * live in SVG type, where they are large enough to survive the viewBox scale.
 * Everything that needs reading is HTML.
 */
function CoverageScene({ airports, caption, className, ...props }: CoverageSceneProps) {
  return (
    <div className={cn("flex w-full flex-col gap-5", className)} {...props}>
      <svg
        viewBox="0 0 460 340"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`Diagram: one pickup area around your door, with routes to the airline bag drops at ${airports.join(", ")}.`}
        className="h-auto w-full"
      >
        <g aria-hidden="true">
          {/* The pickup area around your door */}
          <circle
            cx="112"
            cy="170"
            r="78"
            stroke={SKY_SOFT}
            strokeWidth="2"
            strokeDasharray="6 8"
          />

          {/* Routes out — solid, because a Koolee van actually drives them */}
          {NODES.map((node) => (
            <path
              key={node.cy}
              d={node.arc}
              stroke={SKY}
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.9"
            />
          ))}

          {/* A van on the middle route */}
          <g transform="translate(248 171) scale(0.78)">
            <rect x="-24" y="-22" width="30" height="22" rx="3" fill={NAVY} />
            <path d="M6 -15h10l5 7v8H6Z" fill="#122e50" />
            <path d="M8 -13h7l4 5H8Z" fill={SKY_SOFT} />
            <circle cx="-10" cy="1" r="4" fill="#051222" />
            <circle cx="15" cy="1" r="4" fill="#051222" />
            <circle
              cx="-17"
              cy="-15"
              r="3"
              fill={TAG}
              stroke="#FFFFFF"
              strokeWidth="1.1"
            />
          </g>

          {/* Your door */}
          <circle
            cx="112"
            cy="170"
            r="36"
            fill="#FFFFFF"
            stroke={NAVY}
            strokeWidth="2.5"
          />
          <rect x="101" y="170" width="22" height="16" rx="1.5" fill={NAVY} />
          <path
            d="M96 170 112 156 128 170"
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="109" y="178" width="6" height="8" fill="#FFFFFF" />

          {/* Bag drops */}
          {NODES.map((node, i) => (
            <g key={node.cy}>
              <circle cx="392" cy={node.cy} r="34" fill={NAVY} />
              <circle
                cx="392"
                cy={node.cy}
                r="41"
                stroke={NAVY_SOFT}
                strokeWidth="1.5"
                opacity="0.7"
              />
              <text
                x="392"
                y={node.cy + 8}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="24"
                fontWeight="600"
                letterSpacing="1"
                fontFamily="var(--font-display), system-ui, sans-serif"
              >
                {airports[i]}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li className="flex items-center gap-2 font-medium text-navy-800">
            <span
              aria-hidden="true"
              className="block size-2.5 shrink-0 rounded-full border-2 border-navy-800 bg-white"
            />
            Your door
          </li>
          <li className="flex items-center gap-2 font-medium text-navy-800">
            <span
              aria-hidden="true"
              className="block size-2.5 shrink-0 rounded-full bg-navy-800"
            />
            Your airline&apos;s bag drop
          </li>
        </ul>
        {caption ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{caption}</p>
        ) : null}
      </div>
    </div>
  );
}

export { CoverageScene };
