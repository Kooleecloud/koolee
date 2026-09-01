import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Two or three mutually exclusive views of the same thing.
 *
 * WHY IT IS HERE RATHER THAN IN AN APP. The agent's schedule/history switch
 * and the customer's map/list switch were written independently, three weeks
 * apart, and arrived at the same control by coincidence — the same padded
 * track, the same raised active pill, very nearly the same class strings. Two
 * apps quietly growing their own version of one control is how the consoles
 * drift, and the drift is invisible until somebody notices the two do not
 * behave alike. Lifted on the second use, which is the rule.
 *
 * LINKS *OR* BUTTONS, because the two callers genuinely differ and neither is
 * wrong. The agent's tabs are URLs — a schedule you can bookmark and go back
 * to — so they must be anchors. The customer's map/list is a view preference
 * inside one page that no URL should carry, so it is state. An item with an
 * `href` renders as a link through the caller's own router component; one
 * without renders as a button. Nothing here decides which is right.
 *
 * `role="tablist"` with `aria-selected`, not radios: these switch a view, and
 * a screen reader should announce them as tabs rather than as a form control
 * somebody is expected to submit.
 *
 * NO `"use client"` DIRECTIVE, and that is load-bearing rather than an
 * oversight — `BackLink` is the same for the same reason.
 *
 * A component marked `"use client"` is a client boundary, and `linkComponent`
 * is a FUNCTION. Passing Next's `Link` across that boundary from a Server
 * Component throws at runtime: *"Functions cannot be passed directly to Client
 * Components."* The agent's schedule tabs are exactly that call, and typecheck,
 * lint and the production build were all green over it — only the dev server's
 * request log said anything.
 *
 * Without the directive the component simply inherits its caller: rendered
 * from `trip-driver.tsx` (which IS `"use client"`) the button variant works
 * normally, and rendered from the agent's server-side task list the link
 * variant works normally. One component, both environments, no boundary
 * crossed.
 */

export interface SegmentedControlItem<T extends string> {
  value: T;
  /** What the tab says. A count belongs here — "List · 4". */
  label: React.ReactNode;
  /**
   * Present for a control whose tabs are URLs. Requires `linkComponent`;
   * without one it falls back to a plain anchor, which full-page navigates.
   */
  href?: string;
}

export interface SegmentedControlProps<T extends string> {
  items: readonly SegmentedControlItem<T>[];
  value: T;
  /** Omit for a link-based control — the URL is what changes the value. */
  onChange?: (next: T) => void;
  /** e.g. Next's `Link`. Only consulted for items that carry an `href`. */
  linkComponent?: React.ElementType;
  /** Names the choice for a screen reader: "Map or list". */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  linkComponent: LinkComponent = "a",
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex gap-1 rounded-lg border border-border bg-muted/40 p-1",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        /*
         * The active tab is RAISED rather than tinted: a colour change alone
         * is the thing that disappears at a glance on a small screen and for
         * anybody reading it in bright sun. The card background plus the lift
         * shadow reads as "this one is on top" without relying on hue.
         */
        const classes = cn(
          "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-card text-navy-800 shadow-lift" : "text-muted-foreground",
        );

        if (item.href !== undefined) {
          return (
            <LinkComponent
              key={item.value}
              href={item.href}
              role="tab"
              aria-selected={selected}
              className={classes}
            >
              {item.label}
            </LinkComponent>
          );
        }

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(item.value)}
            className={classes}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
