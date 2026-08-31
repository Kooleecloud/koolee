"use client";

import * as React from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { useGSAP } from "@gsap/react";

import { cn } from "../lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, MotionPathPlugin);
}

/**
 * The hero's signature scene: the whole Koolee trip in one loop.
 *
 * Story order matters and is the product's actual order — everything at the
 * door happens first (ID checked, weighed, sealed, picked up), THEN a van
 * drives, THEN the bags arrive at the airline's bag drop. An earlier version
 * drew four evenly-spaced waypoints along a dashed line, which read as though
 * "sealed" happened somewhere on the road.
 *
 * Two layers, deliberately:
 *  - An SVG illustration that scales (doorstep → road → terminal).
 *  - An HTML beat rail underneath, in real type. SVG `<text>` shrinks with the
 *    viewBox, so on a phone the old in-SVG labels rendered at ~5px. The words
 *    are the point, so they live in HTML and stay legible at every width.
 *
 * Behaviour contract:
 *  - Loops gently; pauses whenever the scene leaves the viewport.
 *  - `prefers-reduced-motion`: no animation — the finished state (every beat
 *    banked, van parked at the terminal) tells the same story at rest.
 *  - Self-contained: no props required, reserves its own aspect ratio (no CLS).
 */

/* Wheel line. The van group is drawn with its wheels at y=0, so this path is
   literally where the tyres go; the road surface is stroked 5 units below. */
const VAN_PATH = "M232 241 C 330 231, 440 227, 560 237";
/** VAN_PATH's endpoints. */
const VAN_START = { x: 232, y: 241 };
const VAN_END = { x: 560, y: 237 };
const ROAD_PATH = "M232 246 C 330 236, 440 232, 560 242";

const NAVY = "#0B2545";
const NAVY_MID = "#122e50";
const NAVY_SOFT = "#B4C5DE";
const NAVY_FAINT = "#DCE4F0";
const SKY = "#38B6E3";
const SKY_SOFT = "#AEE2F5";
const TAG = "#FF6B35";

/** Beat rail colours — hollow dot = not yet, filled = banked. */
const DOT_UNLIT_RING = NAVY_SOFT;
const DOT_UNLIT_FILL = "#FFFFFF";
const LABEL_UNLIT = "#4e74a3"; // navy-400 — 4.8:1 on white, readable while dim
const LABEL_LIT = NAVY;

/** Everything that happens before the van moves. */
const DOOR_BEATS = [
  { id: "id", label: "ID checked" },
  { id: "weighed", label: "Weighed" },
  { id: "sealed", label: "Sealed", isSeal: true },
  { id: "loaded", label: "Picked up" },
] as const;

const ARRIVAL_BEAT = { id: "bagdrop", label: "Arrived at bag drop" } as const;

const ALL_BEATS = [...DOOR_BEATS, ARRIVAL_BEAT];

export type HeroRouteSceneProps = React.HTMLAttributes<HTMLDivElement>;

function Beat({ id, label, isSeal }: { id: string; label: string; isSeal?: boolean }) {
  return (
    <li data-beat={id} className="flex items-center gap-2">
      <span
        aria-hidden="true"
        data-beat-dot={id}
        data-beat-seal={isSeal ? "" : undefined}
        className="block size-2.5 shrink-0 rounded-full border-2"
        style={{ borderColor: DOT_UNLIT_RING, backgroundColor: DOT_UNLIT_FILL }}
      />
      <span
        data-beat-label={id}
        className="text-sm font-medium whitespace-nowrap"
        style={{ color: LABEL_UNLIT }}
      >
        {label}
      </span>
    </li>
  );
}

function HeroRouteScene({ className, ...props }: HeroRouteSceneProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;

      const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);

      const van = q("[data-van]");
      const trail = q<SVGPathElement>("[data-trail]");
      const bags = q("[data-bags]");
      const seals = gsap.utils.toArray<Element>(root.querySelectorAll("[data-seal]"));
      const arrivalRing = q("[data-arrival-ring]");
      const bagDropDoor = q("[data-bagdrop-door]");
      if (!van || !trail || !bags || !arrivalRing || !bagDropDoor) return;

      const dot = (id: string) => q<HTMLElement>(`[data-beat-dot="${id}"]`);
      const label = (id: string) => q<HTMLElement>(`[data-beat-label="${id}"]`);

      const litColor = (id: string) => (id === "sealed" ? TAG : NAVY);

      /** Bank one beat: hollow dot fills, label deepens. */
      const bank = (id: string) => {
        const d = dot(id);
        const l = label(id);
        const tl = gsap.timeline();
        if (d) {
          tl.to(
            d,
            {
              backgroundColor: litColor(id),
              borderColor: litColor(id),
              duration: 0.25,
              ease: "power2.out",
            },
            0,
          ).fromTo(
            d,
            { scale: 1 },
            { scale: 1.35, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" },
            0,
          );
        }
        if (l) tl.to(l, { color: LABEL_LIT, duration: 0.25 }, 0);
        return tl;
      };

      const unbank = () => {
        for (const beat of ALL_BEATS) {
          const d = dot(beat.id);
          const l = label(beat.id);
          if (d)
            gsap.set(d, {
              backgroundColor: DOT_UNLIT_FILL,
              borderColor: DOT_UNLIT_RING,
              scale: 1,
            });
          if (l) gsap.set(l, { color: LABEL_UNLIT });
        }
      };

      const bankAll = () => {
        for (const beat of ALL_BEATS) {
          const d = dot(beat.id);
          const l = label(beat.id);
          if (d)
            gsap.set(d, {
              backgroundColor: litColor(beat.id),
              borderColor: litColor(beat.id),
            });
          if (l) gsap.set(l, { color: LABEL_LIT });
        }
      };

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        // The finished state: every beat banked, bags gone, van at the terminal,
        // the drive already drawn.
        bankAll();
        gsap.set(seals, { autoAlpha: 1 });
        gsap.set(bags, { autoAlpha: 0 });
        gsap.set(trail, { strokeDashoffset: 0 });
        gsap.set(van, { autoAlpha: 1, ...VAN_END });
        // The bag-drop door keeps its sky fill at rest. Orange marks the moment
        // of arrival while it is happening; a permanently orange door would just
        // be a third orange thing in a still frame, which the brand system
        // spends deliberately.
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.8 });

        tl.call(unbank)
          .set(seals, { autoAlpha: 0, scale: 0.4, transformOrigin: "center center" })
          .set(bags, { autoAlpha: 1 })
          .set(trail, { strokeDashoffset: 1 })
          .set(bagDropDoor, { fill: SKY })
          .set(arrivalRing, { autoAlpha: 0, scale: 1, transformOrigin: "center center" })
          .set(van, { autoAlpha: 0, rotation: 0, ...VAN_START })

          /* 1 · At the door, in order. */
          .add(bank("id"), 0.35)
          .add(bank("weighed"), "+=0.6")
          .add(bank("sealed"), "+=0.6")
          .to(
            seals,
            { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2.4)" },
            "<",
          )
          .add(bank("loaded"), "+=0.6")

          /* 2 · Only now does anything move. */
          .to(bags, { autoAlpha: 0, y: -6, duration: 0.4, ease: "power2.in" }, "<0.1")
          .to(van, { autoAlpha: 1, duration: 0.3 }, "<0.15")
          .addLabel("drive", "+=0.15")
          .to(
            van,
            {
              motionPath: { path: VAN_PATH, autoRotate: true },
              duration: 2.4,
              ease: "power1.inOut",
            },
            "drive",
          )
          .to(
            trail,
            { strokeDashoffset: 0, duration: 2.4, ease: "power1.inOut" },
            "drive",
          )

          /* 3 · Arrival at the airline's bag drop. */
          .add(bank("bagdrop"), "-=0.1")
          .to(bagDropDoor, { fill: TAG, duration: 0.3 }, "<")
          .fromTo(
            arrivalRing,
            { autoAlpha: 0.75, scale: 1 },
            { autoAlpha: 0, scale: 2.8, duration: 1, ease: "power2.out" },
            "<",
          )
          .to(van, { autoAlpha: 0, duration: 0.45 }, "+=1.1");

        // Only animate while the scene is on screen.
        const trigger = ScrollTrigger.create({
          trigger: root,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
        });

        return () => {
          trigger.kill();
          tl.kill();
        };
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={cn("flex w-full flex-col gap-5", className)} {...props}>
      <svg
        viewBox="0 16 760 250"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Illustration: at a brownstone doorstep two bags are sealed with orange Koolee tags, a Koolee van drives them along the road, and they arrive at an airport terminal's bag drop."
        className="h-auto w-full"
      >
        <g aria-hidden="true">
          {/* Sky furniture */}
          <g stroke={NAVY_FAINT} strokeWidth="2.5" strokeLinecap="round">
            <path d="M188 48h58M172 62h44M528 34h52M544 48h36" />
          </g>
          <g transform="translate(-24,-46)">
            <path
              d="M648 118l30-8c4-1 6 4 3 6l-24 15-3 12c-1 3-5 3-6 0l-2-10-10 6c-2 1-4-1-3-3l6-9-8-6c-2-2 0-5 3-4l14 1Z"
              fill={SKY_SOFT}
            />
          </g>

          {/* The city the van crosses. Silhouette only — it must never compete
              with the house, the van or the terminal, which carry the story. */}
          <g fill="#E4EBF4">
            <rect x="176" y="150" width="34" height="100" />
            <rect x="214" y="176" width="26" height="74" />
            <rect x="244" y="132" width="30" height="118" />
            <rect x="278" y="164" width="38" height="86" />
            <rect x="320" y="144" width="26" height="106" />
            <rect x="350" y="182" width="34" height="68" />
            <rect x="388" y="156" width="30" height="94" />
            <rect x="422" y="128" width="24" height="122" />
            <rect x="450" y="170" width="36" height="80" />
            <rect x="490" y="150" width="28" height="100" />
            <rect x="522" y="184" width="32" height="66" />
          </g>

          {/* Pavement */}
          <line x1="24" y1="250" x2="736" y2="250" stroke={NAVY_FAINT} strokeWidth="2" />

          {/* Brownstone — where every trip starts */}
          <g>
            <rect
              x="40"
              y="112"
              width="110"
              height="138"
              fill="#FFFFFF"
              stroke={NAVY_SOFT}
              strokeWidth="2.5"
            />
            <rect
              x="34"
              y="102"
              width="122"
              height="12"
              rx="3"
              fill={NAVY_FAINT}
              stroke={NAVY_SOFT}
              strokeWidth="2"
            />
            <g stroke={NAVY_SOFT} strokeWidth="2" fill="#EDF8FD">
              <rect x="54" y="126" width="24" height="28" rx="2" />
              <rect x="90" y="126" width="24" height="28" rx="2" />
              <rect x="54" y="166" width="24" height="28" rx="2" />
              <rect x="90" y="166" width="24" height="28" rx="2" />
              <rect x="54" y="206" width="24" height="28" rx="2" />
            </g>
            {/* Door + stoop */}
            <rect x="102" y="196" width="28" height="54" rx="2" fill={SKY} />
            <circle cx="124" cy="224" r="2" fill={NAVY} />
            <g fill={NAVY_FAINT} stroke={NAVY_SOFT} strokeWidth="2">
              <rect x="130" y="236" width="18" height="14" />
              <rect x="136" y="243" width="20" height="7" />
            </g>
          </g>

          {/* The agent at the door, scanner in hand */}
          <g>
            <path d="M163 250v-16a8 8 0 0 1 16 0v16Z" fill={NAVY_MID} />
            <rect x="163.5" y="235" width="15" height="5" rx="1.5" fill={SKY} />
            <circle cx="171" cy="217" r="7.5" fill={NAVY} />
            <rect
              x="180"
              y="230"
              width="9"
              height="12"
              rx="1.5"
              fill="#FFFFFF"
              stroke={NAVY_SOFT}
              strokeWidth="1.5"
            />
          </g>

          {/* The bags, sealed on the stoop, then gone */}
          <g data-bags>
            <g>
              <rect x="196" y="222" width="24" height="28" rx="3" fill={NAVY} />
              <path
                d="M203 222v-4a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v4"
                stroke={NAVY}
                strokeWidth="2.5"
                fill="none"
              />
              <line
                x1="196"
                y1="232"
                x2="220"
                y2="232"
                stroke="#FFFFFF"
                strokeOpacity="0.3"
                strokeWidth="1.5"
              />
              <circle
                data-seal
                cx="215"
                cy="227"
                r="3.6"
                fill={TAG}
                stroke="#FFFFFF"
                strokeWidth="1.2"
              />
            </g>
            <g>
              <rect x="222" y="232" width="18" height="18" rx="2.5" fill={NAVY_MID} />
              <circle
                data-seal
                cx="236"
                cy="236"
                r="3"
                fill={TAG}
                stroke="#FFFFFF"
                strokeWidth="1.2"
              />
            </g>
          </g>

          {/* The road, and the drive drawn behind the van */}
          <path
            d={ROAD_PATH}
            stroke={NAVY_FAINT}
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            data-trail
            d={ROAD_PATH}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1}
            stroke={SKY}
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Airport: terminal, bag drop, tower */}
          <g>
            <rect
              x="576"
              y="204"
              width="152"
              height="46"
              rx="6"
              fill="#EEF2F8"
              stroke={NAVY_SOFT}
              strokeWidth="2.5"
            />
            <rect
              x="568"
              y="194"
              width="168"
              height="11"
              rx="3"
              fill={NAVY_FAINT}
              stroke={NAVY_SOFT}
              strokeWidth="2"
            />
            <circle
              data-arrival-ring
              cx="630"
              cy="235"
              r="12"
              stroke={SKY}
              strokeWidth="2.5"
              opacity="0"
            />
            <rect
              data-bagdrop-door
              x="616"
              y="220"
              width="28"
              height="30"
              rx="2"
              fill={SKY}
            />
            <rect x="610" y="209" width="40" height="7" rx="2" fill={NAVY} />
            <g stroke={NAVY_SOFT} strokeWidth="2" fill="#EDF8FD">
              <rect x="668" y="218" width="20" height="18" rx="2" />
              <rect x="696" y="218" width="20" height="18" rx="2" />
            </g>
            <rect
              x="690"
              y="128"
              width="14"
              height="66"
              fill="#EEF2F8"
              stroke={NAVY_SOFT}
              strokeWidth="2.5"
            />
            <path d="M678 128h38l-6-22h-26l-6 22Z" fill={NAVY} />
            <line
              x1="697"
              y1="106"
              x2="697"
              y2="90"
              stroke={NAVY_SOFT}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="697" cy="86" r="3" fill={TAG} />
          </g>

          {/* The Koolee van. Drawn with its wheels on y=0 and moved along VAN_PATH. */}
          <g data-van style={{ opacity: 0 }}>
            <rect x="-27" y="-25" width="34" height="25" rx="3" fill={NAVY} />
            <path d="M7 -17h11l6 8v9H7Z" fill={NAVY_MID} />
            <path d="M9 -15h8l4.5 6H9Z" fill={SKY_SOFT} />
            <line
              x1="-27"
              y1="-13"
              x2="7"
              y2="-13"
              stroke="#FFFFFF"
              strokeOpacity="0.25"
              strokeWidth="1.5"
            />
            <circle cx="-11" cy="1" r="4.5" fill="#051222" />
            <circle cx="-11" cy="1" r="1.7" fill="#FFFFFF" />
            <circle cx="17" cy="1" r="4.5" fill="#051222" />
            <circle cx="17" cy="1" r="1.7" fill="#FFFFFF" />
            {/* Seal orange, on the van the way it is on the bags inside it. */}
            <circle
              cx="-19"
              cy="-17"
              r="3.4"
              fill={TAG}
              stroke="#FFFFFF"
              strokeWidth="1.2"
            />
          </g>
        </g>
      </svg>

      {/* The beats, in real type. Order is the product's order. */}
      <div
        className={cn(
          "grid gap-4 rounded-2xl border border-border bg-white/75 p-4 shadow-xs",
          "backdrop-blur-sm sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] sm:gap-6 sm:p-5",
        )}
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.16em] text-navy-400 uppercase">
            At your door
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {DOOR_BEATS.map((beat) => (
              <Beat key={beat.id} {...beat} />
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          <p className="text-[0.6875rem] font-semibold tracking-[0.16em] text-navy-400 uppercase">
            At the airport
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            <Beat {...ARRIVAL_BEAT} />
          </ul>
        </div>
      </div>
    </div>
  );
}

export { HeroRouteScene };
