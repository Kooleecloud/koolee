import * as React from "react";

import { cn } from "../lib/utils";
import { ImageLightbox } from "./image-lightbox";

/**
 * Chain-of-custody timeline — the visual signature of Koolee's trust story.
 *
 * The same language everywhere: a customer's live trip page (`vertical`) and
 * the marketing custody section (`horizontal`) render the identical motif, so
 * what we promise on the landing page is literally what they watch later.
 *
 * Prop-driven and app-agnostic: apps map their domain events to items.
 */

export type CustodyItemState = "complete" | "current" | "upcoming";

export interface CustodyTimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Timestamp line. Pass pre-formatted text plus an ISO string for `<time>`. */
  meta?: React.ReactNode;
  metaDateTime?: string;
  /** Small chip after the title, e.g. the actor role. */
  badge?: React.ReactNode;
  /** Proof photo taken at this hand-off. */
  photoUrl?: string;
  photoAlt?: string;
  /** Icon slot, used by the horizontal marketing variant. */
  icon?: React.ReactNode;
  state?: CustodyItemState;
}

export interface CustodyTimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  items: CustodyTimelineItem[];
  orientation?: "vertical" | "horizontal";
  /** Shown when there are no items yet (vertical only). */
  emptyMessage?: React.ReactNode;
}

/**
 * The stage marker.
 *
 * `block` is load-bearing, not decoration: a bare <span> is display:inline,
 * and width/height do not apply to non-replaced inline elements. The
 * horizontal variant got away with it because the dot is a direct flex item
 * there (flex blockifies its children); in the vertical variant the dot sits
 * inside a wrapper span, so it stayed inline and rendered at 0×0 — every
 * vertical timeline in the product drew its line with no dots on it.
 *
 * Colour carries the state: navy for hand-offs already banked, seal orange
 * for the one happening now (the same orange as the physical tamper seal),
 * hollow for what has not happened yet.
 */
function Dot({ state }: { state: CustodyItemState }) {
  if (state === "current") {
    return (
      <span aria-hidden="true" className="relative block size-3 shrink-0">
        {/* Two elements because one cannot both pulse and stay legible: the
            halo animates, the core stays a solid, readable dot. */}
        <span className="absolute inset-0 animate-ping rounded-full bg-tag opacity-75 motion-reduce:animate-none" />
        <span className="relative block size-3 rounded-full bg-tag ring-4 ring-tag-100" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-3 shrink-0 rounded-full",
        state === "complete" && "bg-navy-800",
        state === "upcoming" && "border-2 border-input bg-white",
      )}
    />
  );
}

function CustodyTimeline({
  items,
  orientation = "vertical",
  emptyMessage = "Nothing has happened yet. Events appear here as your bags move.",
  className,
  ...props
}: CustodyTimelineProps) {
  if (orientation === "vertical" && items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  if (orientation === "horizontal") {
    return (
      <ol
        className={cn("grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4", className)}
        {...props}
      >
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.id} className="flex flex-col gap-4">
              <div className="flex items-center">
                <Dot state={item.state ?? "complete"} />
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="ml-2 hidden flex-1 border-t-2 border-dashed border-sky-400 lg:block"
                  />
                )}
              </div>
              {item.icon ? (
                <div aria-hidden="true" className="text-navy-700 [&_svg]:h-7 [&_svg]:w-auto">
                  {item.icon}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <h3 className="font-display text-base font-semibold text-navy-800">
                  {item.title}
                </h3>
                {item.description ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className={cn("flex flex-col", className)} {...props}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const state = item.state ?? "complete";
        return (
          <li key={item.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="mt-1.5">
                <Dot state={state} />
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    // The rail is always blue — it is the thread the eye
                    // follows; the dots, not the line, carry the state.
                    "flex-1 rounded-full",
                    state === "upcoming"
                      ? "border-l-2 border-dashed border-border"
                      : "w-0.5 bg-sky-400",
                  )}
                />
              )}
            </div>

            <div className="flex flex-1 flex-col gap-1 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    state === "upcoming" ? "text-muted-foreground" : "text-navy-800",
                  )}
                >
                  {item.title}
                </span>
                {item.badge}
              </div>
              {item.meta ? (
                item.metaDateTime ? (
                  <time dateTime={item.metaDateTime} className="text-xs text-muted-foreground">
                    {item.meta}
                  </time>
                ) : (
                  <span className="text-xs text-muted-foreground">{item.meta}</span>
                )
              ) : null}
              {/* A div, not a p: `description` is a ReactNode and consumers
                  pass block content into it (the ops trail nests a <details>
                  raw-data disclosure), which is invalid inside a <p> and
                  triggers a hydration error. Same box either way. */}
              {item.description ? (
                <div className="text-sm text-muted-foreground">{item.description}</div>
              ) : null}
              {item.photoUrl ? (
                /* Click to enlarge. These are captured at ~1200px and shown
                   here at 192px, so the detail that makes a proof photo proof
                   — the seal number, a scuff, a broken zip — exists in the
                   file and is unreadable at this size. Same component ops and
                   the customer use, so both see the same evidence. */
                <ImageLightbox
                  src={item.photoUrl}
                  alt={item.photoAlt ?? "Hand-off proof photo"}
                  title={typeof item.title === "string" ? item.title : undefined}
                  className="mt-1 h-48 w-48"
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { CustodyTimeline };
