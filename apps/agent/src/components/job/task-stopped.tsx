import { Ban, CheckCircle2 } from "lucide-react";
import { Card } from "@koolee/ui";
import { formatInstantInAirportTz, type CancellationRecord } from "@koolee/core";

/**
 * The job is off — the third mode of the task detail page.
 *
 * WHAT WAS BROKEN. F4 stopped a cancelled booking rendering as an ordinary
 * stop on the agent's DAY: the card lost its Navigate and Call buttons and
 * gained a Cancelled badge. Opening that card was untouched. Inside, the
 * detail page still drew the doorstep header with a live Navigate link and a
 * live Call button, and still drew the whole guided flow — "I'm on my way",
 * arrive, scan a seal — for a pickup that was not happening.
 *
 * The server refused every one of those, correctly and invisibly. The screen
 * that decides whether somebody gets in a van did not know.
 *
 * ONE SOURCE, WHICH IS THE POINT. This renders when
 * `bookingActionability(...).standing === "terminal"` — the same computation
 * the card consults and the same one core enforces with. Not a status array
 * in the page: `services/actionability.ts` is where "can this be acted on"
 * is answered, and the last thing this needed was a sixth place answering it
 * differently.
 *
 * THE STOP STAYS VISIBLE, for the reason F4 gave: an agent who remembers
 * being sent to that address needs to find it, and a schedule that quietly
 * loses stops is one nobody can reconcile against what they actually did. So
 * the page still renders `TaskRecord` beneath this — the seals, the timeline,
 * everything that happened before it stopped. This card is the headline; that
 * one is the history, and it is the same component every other finished job
 * uses rather than a second timeline that would drift from it.
 */
export function TaskStopped({
  kind,
  reason,
  cancellation,
  tz,
}: {
  kind: "verification" | "pickup";
  /** The gate's own sentence — `blockedReason` from the actionability read. */
  reason: string | null;
  /** Present only for a cancelled booking; absent for a completed one. */
  cancellation: CancellationRecord | null;
  tz: string;
}) {
  const cancelled = cancellation !== null;

  return (
    <Card
      className={
        cancelled
          ? "flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4"
          : "flex items-start gap-3 border-success/40 bg-success/5 p-4"
      }
    >
      {cancelled ? (
        <Ban aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
      ) : (
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-success"
        />
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {cancelled
            ? kind === "pickup"
              ? "This pickup was cancelled."
              : "This visit was cancelled."
            : "This booking is complete."}
        </p>
        {/*
          WHO CANCELLED IT. The custody trail has recorded the actor since
          the state machine was written and nothing ever rendered it. It
          matters here more than anywhere: "the customer called it off" is
          a closed loop, and "ops cancelled it" is something the agent may
          need to ask about — and they cannot ask without knowing.
        */}
        {cancellation && (
          <p className="text-sm text-muted-foreground">
            Cancelled by {cancellation.by === "customer" ? "the customer" : "ops"} ·{" "}
            {formatInstantInAirportTz(cancellation.at, tz)}
          </p>
        )}
        {cancellation?.reason && (
          <p className="text-sm text-muted-foreground">Reason: {cancellation.reason}</p>
        )}
        {/*
          The gate's own sentence, when it adds something the lines above do
          not already say. Never a second copy of "this was cancelled".
        */}
        {reason && !cancelled && (
          <p className="text-sm text-muted-foreground">{reason}</p>
        )}
        <p className="text-sm text-muted-foreground">
          Nothing to do here. If somebody is expecting you at this address, call ops
          before you go.
        </p>
      </div>
    </Card>
  );
}
