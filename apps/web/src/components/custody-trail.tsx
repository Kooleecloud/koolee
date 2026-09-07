"use client";

import * as React from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CustodyTimeline as CustodyTimelineView,
} from "@koolee/ui";
import type { CustodyTimelineItem } from "@koolee/ui";

/**
 * The chain-of-custody card, and the only client state on it.
 *
 * WHY THE WHOLE CARD LIVES HERE and not just the list. The toggle sits in the
 * card's HEADER, opposite the title, and it has to share state with the list
 * in the body — so the header and the body have to be inside one component
 * that owns that state. Leaving the card on the page and passing a callback
 * down would mean two components rendering one card, which is the arrangement
 * that makes a header and its content drift apart.
 *
 * WHY IT IS A CLIENT COMPONENT AT ALL, and the trap to avoid. Everything that
 * needs `@koolee/core` — formatting a timestamp in the airport's zone,
 * resolving an actor, signing a photo URL — stays on the SERVER in
 * `custody-timeline.tsx`, which hands this component finished items. Marking
 * that file `"use client"` instead drags core, `@koolee/db` and `postgres`
 * into the browser bundle and 500s the whole trip page at request time; it
 * typechecks clean and cost one such 500 to find. React elements cross the RSC
 * boundary as props perfectly well. A Postgres driver does not.
 */
export function CustodyTrail({
  items,
  collapsedCount = 3,
}: {
  /** Already formatted, already signed, newest last. */
  items: CustodyTimelineItem[];
  /** How many to show before the rest are folded away. */
  collapsedCount?: number;
}) {
  /*
   * COLLAPSED BY DEFAULT. A completed booking carries twenty-odd events, each
   * of which used to draw a 192px proof photo, so the chain of custody was a
   * screen and a half of scrolling between the map and everything below it.
   * The trail is the product's whole trust story and is not going anywhere;
   * what changed is that it stopped being the first thing in the reader's way.
   * The newest few answer "what just happened", which is what somebody
   * watching a live trip actually opens the page for.
   *
   * EXPANDS IN PLACE — every event is already in props, so the toggle is a
   * state flip rather than a request.
   */
  const [expanded, setExpanded] = React.useState(false);
  const hidden = Math.max(0, items.length - collapsedCount);
  const visible = expanded || hidden === 0 ? items : items.slice(-collapsedCount);

  return (
    <Card>
      {/*
        THE TOGGLE SITS IN THE HEADER, opposite the title — TD's call, and it
        reads better than the button that used to sit under the list: a control
        below a collapsed list looks like it belongs to the last event rather
        than to the section, and after expanding it walked off down the page
        with the content it had just revealed. In the header it does not move.
      */}
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="font-display text-base">Chain of custody</CardTitle>
          <CardDescription>Every hand-off, recorded as it happens.</CardDescription>
        </div>
        {/*
          NO COUNT IN THE LABEL. "Show full history · 7 earlier events" made
          the reader do arithmetic to find out what they were being offered,
          and the number moved every time the trail grew — a control whose
          label changes under you is one you have to re-read. Two words, and
          the list below is where the events are counted.
        */}
        {hidden > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            {expanded ? "Show the latest" : "Show full history"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <CustodyTimelineView items={visible} />
      </CardContent>
    </Card>
  );
}
