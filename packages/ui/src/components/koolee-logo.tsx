import * as React from "react";

import { cn } from "../lib/utils";

export interface KooleeLogoProps extends React.SVGProps<SVGSVGElement> {
  /** Render the wordmark next to the glyph. */
  withWordmark?: boolean;
}

const SKY = "#38B6E3";
const ORANGE = "#FF6B35";

/** "koolee" — Sora SemiBold outlines, baked so the logo never waits on font loading. */
const WORDMARK_PATHS = [
  "M45.9 97 27.7 71.7H19.6L42.7 42.7H57.2L35.9 69.4L36.2 62.4L61.6 97ZM7.9 97V24H21.8V97Z",
  "M97.7 98.9Q90.5 98.9 85 96.6Q79.5 94.3 75.7 90.4Q71.9 86.5 70 81.5Q68 76.5 68 71V68.9Q68 63.4 70 58.3Q72 53.2 75.9 49.3Q79.8 45.3 85.2 43.1Q90.8 40.8 97.7 40.8Q104.6 40.8 110.1 43.1Q115.6 45.3 119.4 49.3Q123.2 53.2 125.3 58.3Q127.3 63.4 127.3 68.9V71Q127.3 76.5 125.4 81.5Q123.4 86.5 119.6 90.4Q115.8 94.3 110.3 96.6Q104.8 98.9 97.7 98.9ZM97.7 87Q102.8 87 106.2 84.8Q109.8 82.5 111.6 78.7Q113.4 74.8 113.4 70Q113.4 64.9 111.5 61.1Q109.7 57.2 106.1 54.9Q102.6 52.7 97.7 52.7Q92.8 52.7 89.2 54.9Q85.7 57.2 83.8 61.1Q81.9 64.9 81.9 70Q81.9 74.8 83.7 78.7Q85.6 82.5 89.1 84.8Q92.6 87 97.7 87Z",
  "M167.6 98.9Q160.4 98.9 154.9 96.6Q149.4 94.3 145.6 90.4Q141.8 86.5 139.8 81.5Q137.9 76.5 137.9 71V68.9Q137.9 63.4 139.9 58.3Q141.9 53.2 145.8 49.3Q149.7 45.3 155.2 43.1Q160.7 40.8 167.6 40.8Q174.5 40.8 180 43.1Q185.4 45.3 189.3 49.3Q193.2 53.2 195.2 58.3Q197.2 63.4 197.2 68.9V71Q197.2 76.5 195.2 81.5Q193.3 86.5 189.5 90.4Q185.7 94.3 180.2 96.6Q174.7 98.9 167.6 98.9ZM167.6 87Q172.7 87 176.2 84.8Q179.7 82.5 181.5 78.7Q183.3 74.8 183.3 70Q183.3 64.9 181.4 61.1Q179.6 57.2 176 54.9Q172.5 52.7 167.6 52.7Q162.7 52.7 159.1 54.9Q155.6 57.2 153.7 61.1Q151.8 64.9 151.8 70Q151.8 74.8 153.6 78.7Q155.4 82.5 159 84.8Q162.5 87 167.6 87Z",
  "M212.1 97V24H226V97ZM205.3 34.4V24H226V34.4Z",
  "M268.2 98.9Q261.2 98.9 255.9 96.5Q250.7 94.1 247.2 90.1Q243.8 86 242.1 81Q240.3 76 240.3 70.8V68.9Q240.3 63.5 242.1 58.5Q243.8 53.4 247.2 49.5Q250.7 45.5 255.8 43.1Q260.9 40.8 267.6 40.8Q276.4 40.8 282.3 44.7Q288.2 48.5 291.3 54.8Q294.3 61 294.3 68.2V73.2H246.2V64.8H285.6L281.3 68.9Q281.3 63.7 279.8 60Q278.2 56.3 275.2 54.3Q272.2 52.3 267.6 52.3Q262.9 52.3 259.8 54.4Q256.6 56.5 254.9 60.5Q253.3 64.4 253.3 69.9Q253.3 75 254.9 79Q256.4 83 259.8 85.2Q263.1 87.4 268.2 87.4Q273.2 87.4 276.4 85.3Q279.6 83.3 280.6 80.3H293.4Q292.2 85.9 288.8 90.1Q285.4 94.3 280.1 96.6Q274.9 98.9 268.2 98.9Z",
  "M332.2 98.9Q325.2 98.9 319.9 96.5Q314.7 94.1 311.2 90.1Q307.8 86 306.1 81Q304.3 76 304.3 70.8V68.9Q304.3 63.5 306.1 58.5Q307.8 53.4 311.2 49.5Q314.6 45.5 319.8 43.1Q324.9 40.8 331.6 40.8Q340.4 40.8 346.3 44.7Q352.2 48.5 355.3 54.8Q358.3 61 358.3 68.2V73.2H310.2V64.8H349.6L345.3 68.9Q345.3 63.7 343.8 60Q342.2 56.3 339.2 54.3Q336.2 52.3 331.6 52.3Q326.9 52.3 323.8 54.4Q320.6 56.5 318.9 60.5Q317.3 64.4 317.3 69.9Q317.3 75 318.9 79Q320.4 83 323.8 85.2Q327.1 87.4 332.2 87.4Q337.2 87.4 340.4 85.3Q343.6 83.3 344.6 80.3H357.4Q356.2 85.9 352.8 90.1Q349.4 94.3 344.1 96.6Q338.9 98.9 332.2 98.9Z",
];

/**
 * The Koolee brand mark — a tamper-evident luggage tag drawn as the K of
 * "koolee". Tag body and wordmark render in `currentColor` (brand navy by
 * default); the sky arm and orange grommet are fixed brand colors. On dark
 * grounds, pass `className="text-white"`. Usage rules: koolee/brand/BRAND.md.
 */
function KooleeLogo({ className, withWordmark = true, ...props }: KooleeLogoProps) {
  return (
    <span className={cn("inline-flex items-center text-primary", className)}>
      <svg
        viewBox={withWordmark ? "0 0 253.8 48" : "0 0 48 48"}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={withWordmark ? "h-8 w-auto" : "h-8 w-8"}
        aria-hidden="true"
        {...props}
      >
        <path
          d="M16 27.5 38.5 8.5"
          stroke={SKY}
          strokeWidth="8.5"
          strokeLinecap="round"
        />
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M11.5 5h3a6.5 6.5 0 0 1 6.5 6.5v29a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 5 40.5v-29A6.5 6.5 0 0 1 11.5 5Zm1.5 4.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z"
        />
        <path
          d="M16 27.5 37.5 41.5"
          stroke="currentColor"
          strokeWidth="8.5"
          strokeLinecap="round"
        />
        <circle cx="13" cy="12.5" r="3.75" stroke={ORANGE} strokeWidth="2.1" />
        {withWordmark ? (
          <g fill="currentColor" transform="translate(51.7 -8.35) scale(0.55)">
            {WORDMARK_PATHS.map((d) => (
              <path key={d.slice(0, 12)} d={d} />
            ))}
          </g>
        ) : null}
      </svg>
      <span className="sr-only">Koolee</span>
    </span>
  );
}

export { KooleeLogo };
