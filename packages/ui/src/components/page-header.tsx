import * as React from "react";

import { cn } from "../lib/utils";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trailing slot — status badge, primary action. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * The one page-title treatment for every in-app page: display font, one
 * size, one subtitle style. Replaces the three ad-hoc heading conventions
 * that grew across web/admin/agent.
 */
function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  const heading = (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-display-sm font-semibold text-navy-800">
        {title}
      </h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );

  if (!actions) {
    return <header className={className}>{heading}</header>;
  }

  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      {heading}
      <div className="flex shrink-0 items-center gap-3">{actions}</div>
    </header>
  );
}

export { PageHeader };
