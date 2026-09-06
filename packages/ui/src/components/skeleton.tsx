import * as React from "react";

import { cn } from "../lib/utils";

/** Pulsing placeholder block. Size it with width/height utilities. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export interface PageSkeletonProps {
  /** Number of content-card placeholders below the title block. */
  cards?: number;
  className?: string;
}

/**
 * Default content-area skeleton for route `loading.tsx` files: a page-title
 * block plus card placeholders. Announced to screen readers as loading; the
 * surrounding chrome (AppHeader) stays live in the layout above it.
 */
function PageSkeleton({ cards = 2, className }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col gap-6", className)}
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}

export { Skeleton, PageSkeleton };
