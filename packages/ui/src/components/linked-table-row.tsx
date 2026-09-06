"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * A table row where clicking anywhere follows the row's link.
 *
 * The row itself is NOT the link. It forwards a click to the real anchor
 * inside it (`RowLink` — a separate, server-renderable module — marked with
 * `data-row-link`) by calling `.click()` on it, which means:
 *
 *  - the anchor stays the accessible affordance — tab order, focus ring,
 *    middle-click, cmd-click and "open in new tab" all keep working, none of
 *    which survives a `<tr onClick={router.push}>`;
 *  - table semantics are intact. A `<tr role="link">` would strip the row from
 *    the table for screen-reader users, trading their navigation for ours;
 *  - this component needs no router, so it works in any app in the monorepo
 *    regardless of which `Link` implementation the anchor uses.
 *
 * Clicks that land on something else interactive, or that finish a text
 * selection, are left alone — an operator dragging to copy a booking ref
 * should not be navigated away mid-drag.
 */

const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button']";

export interface LinkedTableRowProps extends React.ComponentProps<"tr"> {
  children: React.ReactNode;
}

function LinkedTableRow({ children, className, onClick, ...props }: LinkedTableRowProps) {
  const ref = React.useRef<HTMLTableRowElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    ref.current?.querySelector<HTMLAnchorElement>("a[data-row-link]")?.click();
  };

  return (
    <tr
      ref={ref}
      onClick={handleClick}
      className={cn("cursor-pointer", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export { LinkedTableRow };
