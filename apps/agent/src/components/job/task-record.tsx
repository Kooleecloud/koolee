import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CustodyTimeline,
  FormMessage,
} from "@koolee/ui";
import { formatInstantInAirportTz, type Bag, type CustodyEvent } from "@koolee/core";

/**
 * What happened, after it happened — the locked mode of the task detail page.
 *
 * ONE VIEW, TWO MODES. This is not a separate history page: `/tasks/[taskId]`
 * renders its flow while there is work left and this when there is not. A
 * forked page would drift, and the second copy is always the one nobody
 * remembers to update.
 *
 * READ-ONLY BY CONSTRUCTION, not by hiding buttons. There is no form here
 * because there is nothing left to submit — and, more importantly, because
 * every mutation behind those forms is refused by the state machine and the
 * actionability gates whatever any UI renders. A completed booking has
 * standing `terminal`, which permits none of the five gated actions; a sealed
 * bag refuses a second seal; and `applyTransition` guards on `WHERE status =
 * from`, so a replayed request from a stale tab loses. Proved in
 * `terminal-immutability.integration.test.ts`.
 *
 * WHAT IT SHOWS is the driver's own record: the seals they put on, the weights
 * they took, and the chain of custody in the booking's zone. This is what they
 * look at when somebody asks "what happened with that pickup on Tuesday" —
 * previously a one-line "Visit complete" and nothing else.
 */

/** Agent voice, not customer voice: what THEY did, in their words. */
const LABELS: Record<string, string> = {
  "booking.created": "Booking created",
  "booking.payment_authorized": "Payment authorized",
  "booking.payment_captured": "Payment taken",
  "booking.agent_assigned": "Assigned to you",
  "booking.agent_reassigned": "Reassigned",
  "agreement.accepted": "Customer accepted the agreement",
  "passport.customer_uploaded": "Customer added a passport photo",
  "passport.agent_captured": "You photographed the passport",
  "passport.agent_confirmed": "You confirmed the passport",
  "visit.arrived": "You arrived",
  "visit.identity_verified": "You checked ID",
  "bag.sealed": "Bag sealed and photographed",
  "booking.verified_sealed": "Bags sealed — visit complete",
  "pickup.driver_selected": "Customer chose their driver",
  "pickup.driver_released": "Customer changed driver",
  "pickup.travel_started": "You set off",
  "pickup.seal_scanned": "Seal checked at the door",
  "pickup.seal_mismatch": "A seal didn't match",
  "booking.in_transit": "Bags in the van",
  "booking.delivered_to_bagdrop": "Delivered to the bag drop",
  "booking.completed": "Airline took the bags",
  "booking.cancelled": "Booking cancelled",
  "booking.exception_raised": "Flagged as a problem",
};

export interface TaskRecordProps {
  kind: "verification" | "pickup";
  bookingRef: string;
  bags: readonly Bag[];
  timeline: readonly CustodyEvent[];
  /** The booking's zone. Every time below is rendered in it — docs/TIME.md. */
  tz: string;
  /** True when this ended in an exception rather than a clean finish. */
  exception: boolean;
}

export function TaskRecord({
  kind,
  bookingRef,
  bags,
  timeline,
  tz,
  exception,
}: TaskRecordProps) {
  const sealed = bags.filter((bag) => bag.sealId);

  return (
    <div className="flex flex-col gap-4">
      {exception ? (
        <FormMessage variant="info">
          This one was flagged as a problem and handed to ops. Kept here as a record —
          nothing on this screen can be changed.
        </FormMessage>
      ) : (
        <FormMessage variant="success">
          {kind === "verification"
            ? "Visit complete. Kept here as a record — nothing on this screen can be changed."
            : "Delivered and closed out. Kept here as a record — nothing on this screen can be changed."}
        </FormMessage>
      )}

      {sealed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Seals · {bookingRef}
            </CardTitle>
            <CardDescription>
              The numbers you put on. A seal is single-use stock, so each one identifies
              exactly one bag operation-wide.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {sealed.map((bag) => (
                <li
                  key={bag.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium text-navy-800">
                    Bag {bag.ordinal}
                  </span>
                  <span className="flex items-center gap-2">
                    {bag.weightKg ? (
                      <span className="text-sm text-muted-foreground">
                        {bag.weightKg} kg
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="font-mono">
                      {bag.sealId}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happened</CardTitle>
          <CardDescription>
            Times are local to the departure airport. This log is append-only — a
            correction is a new entry, never an edit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustodyTimeline
            emptyMessage="No events recorded."
            items={timeline.map((event) => ({
              id: event.id,
              title: LABELS[event.eventType] ?? event.eventType,
              meta: formatInstantInAirportTz(event.createdAt, tz),
              metaDateTime: event.createdAt.toISOString(),
              // Every entry is banked: nothing on this screen is in progress.
              state: "complete" as const,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
