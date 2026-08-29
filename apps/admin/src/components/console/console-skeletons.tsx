import { Skeleton } from "@koolee/ui";

/**
 * Route-level loading shapes for the console.
 *
 * `PageSkeleton` from `packages/ui` already covers "a title and some cards",
 * and the console pages that look like that use it directly. These two exist
 * because the board and the split pages do not: a stack of 160px card blocks
 * standing in for a 20-row table makes the page visibly jump when the real
 * content lands, which is the one thing a skeleton is there to prevent.
 *
 * Both compose the shared `Skeleton` primitive — same pulse, same radius,
 * same muted token as every other loading state in the product.
 */

function TitleBlock() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-48 max-w-full" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

/** The dispatch board: title, filter bar, then one tall table block. */
export function ConsoleBoardSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>
      <TitleBlock />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-60" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none opacity-60" />
        ))}
      </div>
    </div>
  );
}

/**
 * The list-plus-form pages — blocks, zones, staff — which all share one
 * `2fr / 1fr` split.
 */
export function ConsoleSplitSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>
      <TitleBlock />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}
