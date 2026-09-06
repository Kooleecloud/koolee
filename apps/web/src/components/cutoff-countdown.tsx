"use client";

import { useEffect, useState } from "react";

import { CUTOFF_HORIZON_MS, formatCutoffDistance } from "@/lib/cutoff-horizon";

/**
 * Counts down to the airline's bag-drop cutoff.
 *
 * The cutoff instant is computed on the server (by `@koolee/core`) and passed
 * in as an ISO string. This component only formats the remaining time — no
 * cutoff arithmetic happens in the browser, where a wrong client clock would
 * make it lie.
 *
 * IT SCALES ITS UNIT and it knows when to say nothing at all: see
 * `lib/cutoff-horizon.ts` for both rules and why raw hours were wrong.
 */
export function CutoffCountdown({
  cutoffAtIso,
  airlineIata,
  airportCode,
}: {
  cutoffAtIso: string;
  airlineIata: string;
  airportCode: string;
}) {
  const cutoffAt = new Date(cutoffAtIso).getTime();
  const [remainingMs, setRemainingMs] = useState(() => cutoffAt - Date.now());

  useEffect(() => {
    const tick = () => setRemainingMs(cutoffAt - Date.now());
    tick();
    // A minute is enough: nothing this renders changes faster than that until
    // the last hour, and the page is already re-fetching on its own.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [cutoffAt]);

  const passed = remainingMs <= 0;

  // Belt and braces with the server's own horizon check on the trip page. The
  // gate is there so this never mounts too early; this is here so a page left
  // open across the boundary cannot start lying either.
  if (!passed && remainingMs > CUTOFF_HORIZON_MS) return null;

  const distance = formatCutoffDistance(remainingMs);

  const tone = passed
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : remainingMs < 2 * 3_600_000
      ? "border-warning/40 bg-warning/10 text-foreground"
      : "border-border bg-muted/50 text-foreground";

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
      {passed ? (
        <>
          <span className="font-medium">
            {airlineIata}&apos;s bag drop at {airportCode} has closed.
          </span>{" "}
          <span className="opacity-80">It closed {distance} ago.</span>
        </>
      ) : (
        <>
          <span className="font-medium">
            {distance} until {airlineIata}&apos;s bag-drop cutoff at {airportCode}.
          </span>{" "}
          <span className="opacity-80">
            Your bags must reach the bag drop before then.
          </span>
        </>
      )}
    </div>
  );
}
