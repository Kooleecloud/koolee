import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { Card, cn } from "@koolee/ui";

import type { AttentionItem, AttentionLevel } from "@/lib/attention";

/**
 * The first thing on the console, and usually one line long.
 *
 * IT COLLAPSES WHEN THERE IS NOTHING WRONG, which is the whole design. The
 * page this replaced showed four stat cards reading `0`, `0`, `2`, `0` — the
 * same shape on a calm morning as on a bad one, so an operator had to read
 * four numbers to learn there was nothing to do. Here the LENGTH is the
 * signal: one green line means go and do something else, and a list you have
 * to scroll means today is going to be busy. You can tell from across a room.
 *
 * Ordered by consequence, not by category — see `buildAttention`.
 */

const LEVEL_STYLE: Record<
  AttentionLevel,
  { icon: typeof TriangleAlert; card: string; icons: string }
> = {
  blocked: {
    icon: CircleAlert,
    card: "border-destructive/50 bg-destructive/5",
    icons: "text-destructive",
  },
  urgent: {
    icon: TriangleAlert,
    card: "border-destructive/40 bg-destructive/5",
    icons: "text-destructive",
  },
  soon: {
    icon: TriangleAlert,
    card: "border-warning/50 bg-warning/5",
    icons: "text-warning-foreground",
  },
};

export function AttentionPanel({
  items,
  summary,
}: {
  items: readonly AttentionItem[];
  /** The calm line's second sentence — "4 pickups today · 2 drivers out". */
  summary: string;
}) {
  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-3 border-success/40 bg-success/5 p-4">
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" />
        <p className="text-sm">
          <span className="font-medium">Nothing needs you right now.</span>{" "}
          <span className="text-muted-foreground">{summary}</span>
        </p>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Needs attention">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {items.length} {items.length === 1 ? "thing needs" : "things need"} you
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const style = LEVEL_STYLE[item.level];
          const Icon = style.icon;
          return (
            <li key={item.id}>
              {/*
                THE WHOLE ROW IS THE LINK. A row with a small "Fix" anchor at
                the end makes somebody aim at a word; the thing they are
                pointing at is the problem, so the problem is the target.
              */}
              <Card asChild className={cn("transition-colors", style.card)}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 p-4 hover:brightness-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-5 shrink-0", style.icons)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{item.title}</span>
                    {item.detail ? (
                      <span className="text-xs text-muted-foreground">{item.detail}</span>
                    ) : null}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    {item.action}
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
