import * as React from "react";

import { cn } from "../lib/utils";

export interface OrDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Label sitting in the rule. Defaults to "or". */
  children?: React.ReactNode;
}

/**
 * A labelled rule between two genuine alternatives.
 *
 * `role="separator"` rather than an `<hr>`: it carries a visible word, and the
 * word is the point — without it a form followed by an upload card reads as
 * "fill this in, then also upload", which is not what either does.
 */
function OrDivider({ children = "or", className, ...props }: OrDividerProps) {
  return (
    <div role="separator" className={cn("flex items-center gap-4", className)} {...props}>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {children}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

export { OrDivider };
