"use client";

import * as React from "react";
import { Navigation } from "lucide-react";
import { Button, toast } from "@koolee/ui";

import { startPickupFromJourney } from "@/app/journey-actions";

/**
 * Navigate — and, when this stop is a pickup leg that has not started yet, the
 * thing that starts it.
 *
 * A PLAIN ANCHOR, NOT A BUTTON THAT NAVIGATES. The href is real and
 * `target="_blank"`, so the browser opens the maps app itself, synchronously,
 * from a genuine user gesture. That is what keeps it immune to popup blocking
 * and to a slow network: if the server action below never resolves, the driver
 * still gets their directions.
 *
 * THE ORDER MATTERS. The action is fired and deliberately NOT awaited before
 * the default navigation proceeds. Awaiting it — or calling
 * `preventDefault()` and navigating afterwards — would put a server round-trip
 * between the driver's thumb and their map, on a phone, in a van, on whatever
 * signal a kerbside has. The bookkeeping is the thing that waits, never the
 * driver.
 *
 * `startPickupTravel` is idempotent in core, so the double-fire this permits
 * (tap Navigate, then tap "Set off" in the guided flow) is a no-op the second
 * time.
 */
export function NavigateAction({
  href,
  /**
   * The pickup task to start, or null when this stop is not a startable
   * pickup — a verification visit, a leg already under way, or one still
   * waiting on the customer to choose a driver. Null makes this an ordinary
   * Navigate link.
   */
  startsPickupTaskId,
  size = "default",
  className,
}: {
  href: string;
  startsPickupTaskId: string | null;
  size?: "default" | "lg";
  className?: string;
}) {
  // Guards against a double-tap firing two actions before the first returns.
  // Not a disabled state: the LINK must keep working either way.
  const firing = React.useRef(false);

  const onClick = () => {
    if (!startsPickupTaskId || firing.current) return;
    firing.current = true;

    void startPickupFromJourney(startsPickupTaskId)
      .then((result) => {
        if (result.ok) {
          // Worth saying out loud: this is the moment the customer's page
          // starts tracking, and the driver should know they are now visible.
          toast.success("Pickup started — your customer can see you on the way.");
        } else if (result.error) {
          // Never blocks the map, so it cannot be an error screen. A driver
          // who sees this can still finish the leg from the job screen.
          toast.error(result.error);
        }
      })
      .finally(() => {
        firing.current = false;
      });
  };

  return (
    <Button asChild variant="outline" size={size} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        <Navigation aria-hidden="true" />
        {startsPickupTaskId ? "Start & navigate" : "Navigate"}
      </a>
    </Button>
  );
}
