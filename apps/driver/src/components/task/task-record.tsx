import { View } from "react-native";
import type { BagRow, CustodyEventRow } from "@koolee/api-contract";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CustodyTimeline,
  FormMessage,
  Text,
} from "@/components/ui";
import { formatInstant, iso } from "@/lib/time";

/**
 * What happened, after it happened — the locked mode of the task detail
 * screen. One view, two modes: the flow while there is work left, this when
 * there is not. Read-only by construction, not by hiding buttons: every
 * mutation behind the flow is refused by the state machine and the
 * actionability gates whatever a screen renders.
 */

/** Driver voice, not customer voice: what THEY did, in their words. */
export const LABELS: Record<string, string> = {
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
  bags: readonly Pick<BagRow, "id" | "ordinal" | "sealId" | "weightKg">[];
  timeline: readonly Pick<CustodyEventRow, "id" | "eventType" | "createdAt">[];
  /** The booking's zone. Every time below is rendered in it. */
  tz: string;
  /**
   * How this task ended, which decides the one line at the top.
   *
   *  - `clean`     — finished the way it was meant to.
   *  - `exception` — flagged and handed to ops.
   *  - `stopped`   — the BOOKING ended underneath it. No banner: `TaskStopped`
   *    renders above this and has already said what happened and who did it.
   */
  outcome: "clean" | "exception" | "stopped";
  testID?: string;
}

export function TaskRecord({
  kind,
  bookingRef,
  bags,
  timeline,
  tz,
  outcome,
  testID = "task-record",
}: TaskRecordProps) {
  const sealed = bags.filter((bag) => bag.sealId);

  return (
    <View testID={testID} className="gap-4">
      {outcome === "exception" ? (
        <FormMessage variant="info">
          This one was flagged as a problem and handed to ops. Kept here as a record —
          nothing on this screen can be changed.
        </FormMessage>
      ) : null}
      {outcome === "clean" ? (
        <FormMessage variant="success">
          {kind === "verification"
            ? "Visit complete. Kept here as a record — nothing on this screen can be changed."
            : "Delivered and closed out. Kept here as a record — nothing on this screen can be changed."}
        </FormMessage>
      ) : null}

      {sealed.length > 0 ? (
        <Card testID={`${testID}-seals`}>
          <CardHeader>
            <CardTitle>Seals · {bookingRef}</CardTitle>
            <CardDescription>
              The numbers you put on. A seal is single-use stock, so each one identifies
              exactly one bag operation-wide.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sealed.map((bag, i) => (
              <View
                key={bag.id}
                testID={`${testID}-seal-${bag.ordinal}`}
                className={
                  i === 0
                    ? "flex-row items-center justify-between gap-3 pb-2.5"
                    : "flex-row items-center justify-between gap-3 border-t border-border py-2.5"
                }
              >
                <Text weight="medium" className="text-sm text-navy-800">
                  Bag {bag.ordinal}
                </Text>
                <View className="flex-row items-center gap-2">
                  {bag.weightKg ? (
                    <Text className="text-sm text-muted-foreground">
                      {bag.weightKg} kg
                    </Text>
                  ) : null}
                  {/* Badge's text is the sans face; a seal id is read out
                      one character at a time, so it gets the mono one. */}
                  <View className="rounded-md border border-transparent bg-secondary px-2 py-0.5">
                    <Text
                      face="mono"
                      weight="medium"
                      className="text-xs text-secondary-foreground"
                    >
                      {bag.sealId}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card testID={`${testID}-timeline`}>
        <CardHeader>
          <CardTitle>What happened</CardTitle>
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
              meta: formatInstant(iso(event.createdAt), tz),
              metaDateTime: event.createdAt,
              // Every entry is banked: nothing on this screen is in progress.
              state: "complete" as const,
            }))}
          />
        </CardContent>
      </Card>
    </View>
  );
}
