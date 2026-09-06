"use client";

import * as React from "react";
import { Button, CustodyTimeline as CustodyTimelineView } from "@koolee/ui";
import type { CustodyTimelineItem } from "@koolee/ui";

/**
 * The collapse, and NOTHING else.
 *
 * WHY THIS FILE EXISTS AT ALL, and it is not a style preference. The collapse
 * needs `useState`, so the component that owns it must be a client component.
 * The obvious move — putting `"use client"` at the top of
 * `custody-timeline.tsx` — looked fine and typechecked clean, and it broke the
 * trip page with a 500: that file imports `formatInstantInAirportTz` from
 * `@koolee/core`, whose barrel reaches `@koolee/db` and then `postgres`, and
 * a server-only driver dragged into a client bundle is a module-not-found at
 * request time.
 *
 * NOTHING TYPECHECKS THAT. `tsc` resolves the types happily; only the bundler
 * knows, and only when the page is actually requested. It was caught by
 * opening the page in a browser and by nothing else in the toolchain.
 *
 * So the split is drawn where the dependency is: everything that needs core —
 * formatting a timestamp in the airport's zone, resolving an actor, signing a
 * photo URL — happens on the SERVER in `custody-timeline.tsx`, which hands
 * this component finished `CustodyTimelineItem`s. React elements pass through
 * the RSC boundary as props perfectly well; a Postgres driver does not.
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
   * The newest three answer "what just happened", which is what somebody
   * watching a live trip actually opens the page for.
   *
   * EXPANDS IN PLACE — every event is already in props, so the button is a
   * state flip rather than a request.
   */
  const [expanded, setExpanded] = React.useState(false);
  const hidden = Math.max(0, items.length - collapsedCount);
  const visible = expanded || hidden === 0 ? items : items.slice(-collapsedCount);

  return (
    <div className="flex flex-col gap-3">
      <CustodyTimelineView items={visible} />
      {hidden > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {expanded
            ? "Show less"
            : `Show full history · ${hidden} earlier ${hidden === 1 ? "event" : "events"}`}
        </Button>
      )}
    </div>
  );
}
