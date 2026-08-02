"use client";

import * as React from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { cn } from "../lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
}

export interface RevealProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Animate direct children individually, this many seconds apart. */
  stagger?: number;
  /** Entry offset in px. */
  y?: number;
  delay?: number;
}

/**
 * Scroll-triggered entrance. Content is visible by default and only hidden
 * once GSAP takes over (progressive enhancement — no JS, no blank sections),
 * animates once when ~15% into the viewport, and is skipped entirely under
 * `prefers-reduced-motion`.
 *
 * The entrance tween is deliberately NOT linked to the ScrollTrigger
 * (`onEnter` fires a standalone `gsap.to`): a linked `from` tween gets
 * reverted by `ScrollTrigger.refresh()` on viewport resize, which can strand
 * content invisible if the resize lands mid-animation. An unlinked tween
 * always runs to its visible end state.
 */
function Reveal({ children, stagger, y = 28, delay = 0, className, ...props }: RevealProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const targets: gsap.TweenTarget = stagger != null ? Array.from(el.children) : el;
        gsap.set(targets, { autoAlpha: 0, y });

        const trigger = ScrollTrigger.create({
          trigger: el,
          start: "top 85%",
          once: true,
          onEnter: () => {
            gsap.to(targets, {
              autoAlpha: 1,
              y: 0,
              duration: 0.7,
              delay,
              ease: "power3.out",
              stagger: stagger ?? 0,
              overwrite: true,
              clearProps: "opacity,visibility,transform",
            });
          },
        });

        return () => trigger.kill();
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={cn(className)} {...props}>
      {children}
    </div>
  );
}

export { Reveal };
