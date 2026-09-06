import * as React from "react";

import { cn } from "../lib/utils";
import { StageDot, type StageState } from "./stage-dot";

/**
 * A short, fixed progression with a "you are here" — the driver's run on the
 * customer's trip page, and anything else shaped like it.
 *
 * WHY THIS EXISTS RATHER THAN A LOCAL COPY. The trip page drew its own strip:
 * smaller dots, a different blue, a hairline rail and no marker for the step
 * in progress — sitting on the same screen as the custody trail, which uses
 * `CustodyTimeline`'s navy/seal-orange dots. Two progressions, one page, two
 * visual languages, and the one describing what is happening RIGHT NOW was
 * the quieter of the two. Both draw `StageDot` now.
 *
 * NOT `CustodyTimeline`. That component renders a record — real events that
 * happened, each with a timestamp, an actor and sometimes a proof photo, and
 * as many of them as there are. This renders a fixed set of stages, most of
 * which have not happened, and its whole job is to say which one is current.
 * Same marker, different question; folding them together would mean a
 * timeline that sometimes invents events.
 *
 * NOT `MilestoneTrack` either — that is the marketing chip row (mono type,
 * chevrons, the last item emphasised as a destination) and it has no notion
 * of a current position, which is the only thing this needs to say.
 */

export interface ProgressTrackProps extends Omit<
  React.HTMLAttributes<HTMLOListElement>,
  "children"
> {
  /** In order. Short labels — this is a strip, not a description. */
  steps: readonly string[];
  /**
   * The step in progress. Everything before it reads as done, everything
   * after as still to come. `-1` (or anything below zero) marks nothing
   * current, which is how an exception booking renders.
   */
  currentIndex: number;
  /**
   * The whole progression stopped, and did not finish.
   *
   * Every stage draws as `cancelled` and the rail goes dashed throughout, so
   * the track still SHOWS the journey that was planned while saying plainly
   * that none of it is coming. The alternative — hiding the track on a
   * cancelled booking — is what made a cancelled stop read as though it had
   * never been booked.
   *
   * Separate from `currentIndex: -1`, which means "nothing is happening right
   * now" (an exception, a pause). This means "nothing is going to".
   */
  cancelled?: boolean;
}

function stateFor(index: number, currentIndex: number): StageState {
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "current";
  return "upcoming";
}

function ProgressTrack({
  steps,
  currentIndex,
  cancelled = false,
  className,
  ...props
}: ProgressTrackProps) {
  if (steps.length === 0) return null;

  return (
    <ol className={cn("flex flex-col sm:flex-row sm:items-start", className)} {...props}>
      {steps.map((step, i) => {
        const state: StageState = cancelled ? "cancelled" : stateFor(i, currentIndex);
        const isLast = i === steps.length - 1;
        return (
          <li
            key={step}
            className="flex flex-1 items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
            aria-current={state === "current" ? "step" : undefined}
          >
            <div className="flex items-center sm:w-full">
              <StageDot state={state} />
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    // The same rule as the vertical custody timeline: the rail
                    // is solid once a stage is behind you and dashed while it
                    // is still ahead. The dots carry the state; the rail says
                    // how far the thread has been drawn.
                    "ml-2 hidden flex-1 sm:block",
                    state === "complete"
                      ? "h-0.5 rounded-full bg-sky-400"
                      : "border-t-2 border-dashed border-border",
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                "text-sm",
                state === "current" && "font-medium text-navy-800",
                state === "complete" && "text-muted-foreground",
                state === "upcoming" && "text-navy-300",
                // Struck through, not hidden: the label is what makes the
                // dot's meaning readable rather than decorative.
                state === "cancelled" && "text-muted-foreground line-through",
              )}
            >
              {step}
              {state === "current" ? (
                <span className="sr-only"> — current step</span>
              ) : null}
              {state === "cancelled" ? (
                <span className="sr-only"> — cancelled</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export { ProgressTrack };
