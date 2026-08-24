import * as React from "react";

import { cn } from "../lib/utils";

const NAVY = "#0B2545";
const NAVY_MID = "#122e50";
const SKY = "#38B6E3";
const SKY_SOFT = "#AEE2F5";
const TAG = "#FF6B35";

export type JourneyGlyphName = "book" | "seal" | "track" | "deliver";

/**
 * Optical sizing. Callers set a height (`h-11`) and let the width follow, so a
 * glyph whose drawing only occupies the middle of the 48x48 box renders visibly
 * smaller than its siblings — the bag-and-tag and the van both did. Each entry
 * recentres that glyph's own bounding box on the viewBox centre and scales it up
 * to fill, which is what makes the four read as one weight in a row.
 *
 * Values are `[centreX, centreY, scale]` of the drawn content.
 */
const NORMALIZE: Record<JourneyGlyphName, [number, number, number]> = {
  book: [24, 24, 1.15],
  seal: [26.5, 25, 1.22],
  track: [21.5, 26.2, 1.22],
  deliver: [24, 23, 1.12],
};

function normalizeTransform(name: JourneyGlyphName): string {
  const [cx, cy, scale] = NORMALIZE[name];
  return `translate(24 24) scale(${scale}) translate(${-cx} ${-cy})`;
}

export interface JourneyGlyphProps extends React.SVGProps<SVGSVGElement> {
  name: JourneyGlyphName;
  /** Pass null when adjacent text already names the step (the usual case). */
  label?: string | null;
}

/**
 * The four steps of the journey, drawn.
 *
 * These exist because the step cards carry a title and nothing else — the copy
 * review cut the explanatory paragraphs, which puts the whole load on the
 * picture. Generic outline icons could not carry it: these deliberately reuse
 * the hero scene's vocabulary (a sealed bag, the van, the terminal's bag-drop
 * doorway) so the page reads as one continuous story rather than four stock
 * symbols.
 *
 * Tag orange appears on exactly one glyph — `seal` — because there it *is* the
 * physical seal, which is the only non-CTA licence the brand system grants it.
 */
function JourneyGlyph({ name, label = null, className, ...props }: JourneyGlyphProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-10 w-auto", className)}
      {...(label === null
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
      {...props}
    >
      {name === "book" ? (
        <g transform={normalizeTransform("book")}>
          {/* A phone, and the confirmation on it */}
          <rect
            x="13"
            y="5"
            width="22"
            height="38"
            rx="4.5"
            stroke={SKY}
            strokeWidth="2.5"
          />
          <line
            x1="21"
            y1="10.5"
            x2="27"
            y2="10.5"
            stroke={SKY}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M18 25.5 22.5 30 30 20"
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="19"
            y1="36.5"
            x2="29"
            y2="36.5"
            stroke={SKY_SOFT}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      ) : null}

      {name === "seal" ? (
        <g transform={normalizeTransform("seal")}>
          {/* A bag, closed with a serialized orange tag */}
          <path
            d="M17 17v-4.5a3.5 3.5 0 0 1 3.5-3.5h3a3.5 3.5 0 0 1 3.5 3.5V17"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect x="8" y="17" width="20" height="24" rx="3" fill={NAVY} />
          <line
            x1="8"
            y1="26"
            x2="28"
            y2="26"
            stroke="#FFFFFF"
            strokeOpacity="0.3"
            strokeWidth="2"
          />
          <path
            d="M28 21c3 0 4 .8 5 2"
            stroke={NAVY}
            strokeOpacity="0.5"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect x="32" y="19" width="13" height="10" rx="4" fill={TAG} />
          <circle cx="35" cy="24" r="1.7" fill="#FFFFFF" />
          <line
            x1="42"
            y1="21"
            x2="42"
            y2="27"
            stroke={NAVY}
            strokeOpacity="0.4"
            strokeWidth="1.4"
            strokeDasharray="1.5 2"
            strokeLinecap="round"
          />
        </g>
      ) : null}

      {name === "track" ? (
        <g transform={normalizeTransform("track")}>
          {/* The van, reporting its position */}
          <path
            d="M17 11a10 10 0 0 1 14 0"
            stroke={SKY}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M20.5 15.5a5.5 5.5 0 0 1 7 0"
            stroke={SKY}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M3 37c4-1.5 6-3 9-4"
            stroke={SKY}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect x="12" y="21" width="18" height="15" rx="2.5" fill={NAVY} />
          <path d="M30 25h5.5l4.5 6v5H30Z" fill={NAVY_MID} />
          <path d="M31.5 27h4l3 4h-7Z" fill={SKY_SOFT} />
          <circle cx="18.5" cy="38" r="3.4" fill="#051222" />
          <circle cx="34" cy="38" r="3.4" fill="#051222" />
        </g>
      ) : null}

      {name === "deliver" ? (
        <g transform={normalizeTransform("deliver")}>
          {/* The terminal, and its bag-drop doorway */}
          <path
            d="M33 5l9-2c1.2-.3 1.9 1.2.9 1.8l-7.4 4.6-.9 3.6c-.3.9-1.5.9-1.8 0l-.6-3-3 1.8c-.6.4-1.2-.3-.9-.9l1.8-2.7-2.4-1.8c-.6-.5 0-1.5.9-1.2l4.2.3Z"
            fill={SKY_SOFT}
          />
          <rect x="5" y="17" width="38" height="6" rx="2.5" fill={NAVY} />
          <path
            d="M8 23v20h32V23"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect x="19" y="30" width="10" height="13" rx="1.5" fill={SKY} />
          <g stroke={NAVY} strokeWidth="2" fill="none">
            <rect x="11.5" y="29" width="5" height="5" rx="1" />
            <rect x="31.5" y="29" width="5" height="5" rx="1" />
          </g>
        </g>
      ) : null}
    </svg>
  );
}

export { JourneyGlyph };
