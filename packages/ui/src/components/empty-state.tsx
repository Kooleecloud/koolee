import * as React from "react";

import { cn } from "../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

export interface EmptyStateProps {
  /** Optional glyph above the title (a lucide icon or the mono tag mark). */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Optional way forward — a CTA, "clear filter" link, etc. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * The one empty-state shape for lists and unconfigured surfaces. Prefer
 * passing an `action`: an empty state that offers the next step ("Book a
 * pickup", "Clear filter") beats a dead end.
 */
function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Card className={cn("text-center", className)}>
      <CardHeader>
        {icon ? (
          <div className="mx-auto mb-1 text-muted-foreground [&_svg]:size-8">{icon}</div>
        ) : null}
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {action ? <CardContent className="flex justify-center">{action}</CardContent> : null}
    </Card>
  );
}

/**
 * Canonical "no database" state for scaffold mode — one copy of the message
 * that was previously cloned per page. Dev-facing by nature: production
 * always has a database.
 */
function DatabaseNotConfigured({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      title="Database not configured"
      description={
        <>
          Set <code>DATABASE_URL</code> in <code>.env.local</code>, then run{" "}
          <code>pnpm db:migrate &amp;&amp; pnpm seed</code>.
        </>
      }
    />
  );
}

export { EmptyState, DatabaseNotConfigured };
