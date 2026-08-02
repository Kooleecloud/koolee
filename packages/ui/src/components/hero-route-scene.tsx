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
 * The hero's signature scene: a sealed bag travels a drawn route from a
 * brownstone doorstep to the airport, pausing at the four custody waypoints
 * (pickup → seal → transit → bag drop).
 *
 * Behaviour contract:
 *  - Loops gently; pauses whenever the scene leaves the viewport.
 *  - `prefers-reduced-motion`: no animation — a static illustration with all
 *    waypoints lit tells the same story.
 *  - Self-contained: no props required, reserves its own aspect ratio (no CLS).
 */

/* Route segments — each ends exactly on a waypoint so pauses land on dots. */
const SEG_PICKUP_TO_SEAL = "M150 330 C 200 280, 245 262, 290 265";
const SEG_SEAL_TO_TRANSIT = "M290 265 C 335 268, 405 228, 450 235";
const SEG_TRANSIT_TO_DROP = "M450 235 C 495 242, 585 270, 610 330";
const FULL_ROUTE = `${SEG_PICKUP_TO_SEAL} C 335 268, 405 228, 450 235 C 495 242, 585 270, 610 330`;

const WAYPOINTS = [
  { id: "pickup", x: 150, y: 330, label: "Pickup", labelY: 356 },
  { id: "seal", x: 290, y: 265, label: "Sealed", labelY: 246 },
  { id: "transit", x: 450, y: 235, label: "In transit", labelY: 216 },
  { id: "bagdrop", x: 610, y: 330, label: "Bag drop", labelY: 356 },
] as const;

const NAVY = "#0B2545";
const NAVY_SOFT = "#B4C5DE";
const NAVY_FAINT = "#DCE4F0";
const SKY = "#38B6E3";
const SKY_SOFT = "#AEE2F5";
const TAG = "#FF6B35";
const UNLIT = "#B4C5DE";

export type HeroRouteSceneProps = React.HTMLAttributes<HTMLDivElement>;

function HeroRouteScene({ className, ...props }: HeroRouteSceneProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;

      const dots: Element[] = [];
      const rings: Element[] = [];
      for (const w of WAYPOINTS) {
        const dot = root.querySelector(`[data-wp-dot="${w.id}"]`);
        const ring = root.querySelector(`[data-wp-ring="${w.id}"]`);
        if (!dot || !ring) return;
        dots.push(dot);
        rings.push(ring);
      }
      const traveler = root.querySelector("[data-traveler]");
      if (!traveler) return;

      const litColor = (id: string) => (id === "seal" ? TAG : SKY);

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        // Static fallback: full story at rest — every waypoint lit, no traveler.
        dots.forEach((dot, i) => {
          const wp = WAYPOINTS[i];
          if (wp) gsap.set(dot, { fill: litColor(wp.id) });
        });
        gsap.set(traveler, { autoAlpha: 0 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const pulse = (i: number) => {
          const wp = WAYPOINTS[i];
          const dot = dots[i];
          const ring = rings[i];
          if (!wp || !dot || !ring) return gsap.timeline();
          return gsap
            .timeline()
            .to(dot, { fill: litColor(wp.id), duration: 0.2 }, 0)
            .fromTo(
              ring,
              { scale: 1, opacity: 0.7, transformOrigin: "center center" },
              { scale: 2.6, opacity: 0, duration: 0.9, ease: "power2.out" },
              0,
            );
        };

        const travel = (segment: string, duration: number) => ({
          motionPath: { path: segment },
          duration,
          ease: "power1.inOut",
        });

        const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });

        // Transforms are SVG user units; (150, 330) is the pickup waypoint.
        tl.set(traveler, { x: 150, y: 330, autoAlpha: 0 })
          // Reset dots to unlit at the top of every loop.
          .set(
            dots.filter((_, i) => i > 0),
            { fill: UNLIT },
          )
          .to(traveler, { autoAlpha: 1, duration: 0.4 })
          .add(pulse(0), "<")
          .addLabel("depart", "+=0.3")
          .to(traveler, travel(SEG_PICKUP_TO_SEAL, 1.5), "depart")
          .add(pulse(1))
          .to(traveler, travel(SEG_SEAL_TO_TRANSIT, 1.5), "+=0.55")
          .add(pulse(2))
          .to(traveler, travel(SEG_TRANSIT_TO_DROP, 1.7), "+=0.55")
          .add(pulse(3))
          .to(traveler, { autoAlpha: 0, duration: 0.5 }, "+=1.1");

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
    <div ref={ref} className={cn("w-full", className)} {...props}>
      <svg
        viewBox="0 0 760 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Illustration: a sealed bag travels from a brownstone doorstep along a route to the airport, with stops at pickup, seal, in transit, and bag drop."
        className="h-auto w-full"
      >
        <g aria-hidden="true">
          {/* Ground */}
          <line x1="40" y1="340" x2="720" y2="340" stroke={NAVY_FAINT} strokeWidth="2" />

          {/* Clouds */}
          <g stroke={NAVY_FAINT} strokeWidth="2.5" strokeLinecap="round">
            <path d="M188 96h58M172 110h44M540 70h52M556 84h36" />
          </g>

          {/* Plane silhouette, cruising */}
          <path
            d="M648 118l30-8c4-1 6 4 3 6l-24 15-3 12c-1 3-5 3-6 0l-2-10-10 6c-2 1-4-1-3-3l6-9-8-6c-2-2 0-5 3-4l14 1Z"
            fill={SKY_SOFT}
          />

          {/* Brownstone: home, where pickup happens */}
          <g>
            <rect x="48" y="180" width="120" height="160" fill="#FFFFFF" stroke={NAVY_SOFT} strokeWidth="2.5" />
            <rect x="42" y="170" width="132" height="12" rx="3" fill={NAVY_FAINT} stroke={NAVY_SOFT} strokeWidth="2" />
            {/* Windows */}
            <g stroke={NAVY_SOFT} strokeWidth="2" fill="#EDF8FD">
              <rect x="62" y="196" width="24" height="30" rx="2" />
              <rect x="100" y="196" width="24" height="30" rx="2" />
              <rect x="62" y="240" width="24" height="30" rx="2" />
              <rect x="100" y="240" width="24" height="30" rx="2" />
              <rect x="62" y="284" width="24" height="30" rx="2" />
            </g>
            {/* Door + stoop */}
            <rect x="118" y="288" width="28" height="52" rx="2" fill={SKY} />
            <circle cx="140" cy="315" r="2" fill={NAVY} />
            <g fill={NAVY_FAINT} stroke={NAVY_SOFT} strokeWidth="2">
              <rect x="146" y="326" width="18" height="14" />
              <rect x="152" y="333" width="20" height="7" />
            </g>
          </g>

          {/* Airport: terminal + control tower */}
          <g>
            <rect x="560" y="292" width="160" height="48" rx="8" fill="#EEF2F8" stroke={NAVY_SOFT} strokeWidth="2.5" />
            {/* Bag-drop entrance */}
            <rect x="598" y="306" width="26" height="34" rx="2" fill={SKY} />
            <rect x="592" y="296" width="38" height="8" rx="2" fill={NAVY} />
            {/* Control tower */}
            <rect x="654" y="212" width="14" height="80" fill="#EEF2F8" stroke={NAVY_SOFT} strokeWidth="2.5" />
            <path d="M642 212h38l-6-24h-26l-6 24Z" fill={NAVY} />
            <line x1="661" y1="188" x2="661" y2="168" stroke={NAVY_SOFT} strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="661" cy="164" r="3" fill={TAG} />
          </g>

          {/* The route — a dashed flight-plan line */}
          <path
            d={FULL_ROUTE}
            stroke={SKY}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="1 10"
            opacity="0.9"
          />

          {/* Waypoints */}
          {WAYPOINTS.map((w, i) => (
            <g key={w.id}>
              <circle
                data-wp-ring={w.id}
                cx={w.x}
                cy={w.y}
                r="8"
                stroke={w.id === "seal" ? TAG : SKY}
                strokeWidth="2"
                opacity="0"
              />
              <circle
                data-wp-dot={w.id}
                cx={w.x}
                cy={w.y}
                r="6.5"
                fill={i === 0 ? SKY : UNLIT}
              />
              <circle cx={w.x} cy={w.y} r="2.5" fill="#FFFFFF" />
              <text
                x={w.x}
                y={w.labelY}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                letterSpacing="1.5"
                fill={NAVY}
                fillOpacity="0.55"
                fontFamily="var(--font-sans), system-ui, sans-serif"
                style={{ textTransform: "uppercase" }}
              >
                {w.label.toUpperCase()}
              </text>
            </g>
          ))}

          {/* The traveler: a sealed bag. Drawn at origin, moved along the route. */}
          <g data-traveler style={{ opacity: 0 }}>
            <rect x="-11" y="-9" width="22" height="17" rx="3" fill={NAVY} />
            <path
              d="M-5 -9v-3.5a2.5 2.5 0 0 1 2.5-2.5h5A2.5 2.5 0 0 1 5 -12.5V-9"
              stroke={NAVY}
              strokeWidth="2.5"
              fill="none"
            />
            <line x1="-11" y1="-2" x2="11" y2="-2" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1.5" />
            {/* The orange seal on the bag */}
            <circle cx="8" cy="-6" r="3" fill={TAG} stroke="#FFFFFF" strokeWidth="1" />
          </g>
        </g>
      </svg>
    </div>
  );
}

export { HeroRouteScene };
