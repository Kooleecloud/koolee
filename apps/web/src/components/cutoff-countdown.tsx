"use client";

import { useEffect, useState } from "react";

/**
 * Counts down to the airline's bag-drop cutoff.
 *
 * The cutoff instant is computed on the server (by `@koolee/core`) and passed
 * in as an ISO string. This component only formats the remaining time — no
 * cutoff arithmetic happens in the browser, where a wrong client clock would
 * make it lie.
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
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [cutoffAt]);

  const passed = remainingMs <= 0;
  const hours = Math.floor(Math.abs(remainingMs) / 3_600_000);
  const minutes = Math.floor((Math.abs(remainingMs) % 3_600_000) / 60_000);

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
          <span className="opacity-80">
            It closed {hours}h {minutes}m ago.
          </span>
        </>
      ) : (
        <>
          <span className="font-medium">
            {hours}h {minutes}m until {airlineIata}&apos;s bag-drop cutoff at{" "}
            {airportCode}.
          </span>{" "}
          <span className="opacity-80">
            Your bags must reach the bag drop before then.
          </span>
        </>
      )}
    </div>
  );
}
