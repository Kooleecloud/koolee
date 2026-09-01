import { RotateCcw } from "lucide-react";
import { Button } from "@koolee/ui";

import { dismissStashedDraft, resumeStashedDraft } from "@/app/book/actions";

/**
 * "You had a booking in progress. Pick it up?"
 *
 * The other half of the fresh-entry reset. `/book` now starts a clean booking
 * and sets the old draft ASIDE rather than resuming into it — which fixes the
 * complaint (a second trip inheriting a stale one) and would create the
 * opposite one if this line did not exist: somebody who wandered off mid-flow
 * and came back through the front door would find their work apparently gone.
 *
 * It is a LINE, not a dialog. An interstitial "resume or start over?" screen
 * asks everybody to answer a question most of them do not have, in front of
 * the step they actually came for. This sits above the first step, which is
 * already usable and already empty, and is ignorable by doing nothing.
 *
 * WHAT IT SAYS is what they left, not what we stored: a route and a date is
 * how somebody recognises their own half-finished booking. "You have a saved
 * draft" describes our cookie.
 */
export function ResumeDraftOffer({
  summary,
}: {
  /** A human line — "JFK · DL123 on 4 Sep" — or null when we only know it exists. */
  summary: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3">
      <p className="flex items-start gap-2 text-sm">
        <RotateCcw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky-700" />
        <span>
          <span className="font-medium">You had a booking in progress.</span>{" "}
          {summary ? (
            <span className="text-muted-foreground">{summary}</span>
          ) : (
            <span className="text-muted-foreground">
              Pick up where you left off, or carry on with this one.
            </span>
          )}
        </span>
      </p>
      <span className="flex items-center gap-2">
        {/*
          TWO FORMS, NOT ONE WITH TWO SUBMIT BUTTONS. Each posts to its own
          action, so neither can be reached by the other's formaction and
          "dismiss" can never be one misplaced attribute away from restoring a
          draft over the form somebody is typing into.
        */}
        <form action={dismissStashedDraft}>
          <Button type="submit" variant="ghost" size="sm">
            No thanks
          </Button>
        </form>
        <form action={resumeStashedDraft}>
          <Button type="submit" variant="secondary" size="sm">
            Resume it
          </Button>
        </form>
      </span>
    </div>
  );
}
