import { cn } from "../lib/utils";

/**
 * The stage marker — one dot, three states, used by everything in the product
 * that draws progress.
 *
 * It lives on its own because it IS the visual language: navy for a stage
 * already banked, seal orange (the same orange as the physical tamper seal)
 * pulsing for the one happening now, hollow for what has not happened yet.
 * `CustodyTimeline` and `ProgressTrack` both draw it, so a customer watching
 * their bags moves through one vocabulary rather than two that happen to look
 * similar. The driver-tracking strip used to draw its own — smaller, a
 * different blue, no "you are here" pulse — on the same page as the custody
 * trail, and the two did not match.
 *
 * `block` is load-bearing, not decoration: a bare `<span>` is display:inline,
 * and width/height do not apply to non-replaced inline elements. The
 * horizontal timeline got away with it because the dot is a direct flex item
 * there (flex blockifies its children); in the vertical variant the dot sits
 * inside a wrapper span, so it stayed inline and rendered at 0×0 — every
 * vertical timeline in the product drew its line with no dots on it.
 */

/**
 * `cancelled` is the fourth state, and it exists so a stop that did not happen
 * can stay ON the track instead of vanishing from it.
 *
 * A dropped stop rewrites history — the customer, the agent and ops each see a
 * journey that never had the leg somebody cancelled, which makes "what
 * happened to my bags?" unanswerable from the screen that is supposed to
 * answer it. So the dot stays, hollow with a line struck through it, reading
 * as "this was here and it is not happening" rather than as "not yet".
 */
export type StageState = "complete" | "current" | "upcoming" | "cancelled";

export interface StageDotProps {
  state?: StageState;
  className?: string;
}

function StageDot({ state = "complete", className }: StageDotProps) {
  if (state === "current") {
    return (
      <span
        aria-hidden="true"
        className={cn("relative block size-3 shrink-0", className)}
      >
        {/* Two elements because one cannot both pulse and stay legible: the
            halo animates, the core stays a solid, readable dot. */}
        <span className="absolute inset-0 animate-ping rounded-full bg-tag opacity-75 motion-reduce:animate-none" />
        <span className="relative block size-3 rounded-full bg-tag ring-4 ring-tag-100" />
      </span>
    );
  }
  if (state === "cancelled") {
    return (
      <span
        aria-hidden="true"
        className={cn("relative block size-3 shrink-0", className)}
      >
        <span className="block size-3 rounded-full border-2 border-muted-foreground/50 bg-white" />
        {/* The strike is what separates "cancelled" from "not yet". A muted
            hollow dot on its own is indistinguishable from an upcoming one at
            a glance, which is the whole failure this state exists to avoid. */}
        <span className="absolute top-1/2 left-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-muted-foreground/70" />
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
        className,
      )}
    />
  );
}

export { StageDot };
