import { Badge, CustodyTimeline as CustodyTimelineView } from "@koolee/ui";
import { formatInstantInAirportTz, type CustodyEvent } from "@koolee/core";

/**
 * Chain-of-custody timeline for /trips — maps `custody_events` rows onto the
 * shared `CustodyTimeline` visual in @koolee/ui (the same motif the marketing
 * site uses, so the product looks like the promise).
 *
 * Server-rendered from `custody_events`, which is append-only — a faithful
 * record, not a summary that could drift from what happened.
 *
 * TODO(realtime): subscribe to INSERTs on `custody_events` for this booking via
 * supabase-js so the timeline updates live while a pickup is in progress.
 * Migration 0001 already enables RLS (`custody_events_select_own`), sets
 * REPLICA IDENTITY FULL, and adds the table to the `supabase_realtime`
 * publication, so the database side is done. What remains:
 *
 *   1. a client component that calls
 *      `supabase.channel('custody:<bookingId>').on('postgres_changes',
 *       { event: 'INSERT', schema: 'public', table: 'custody_events',
 *         filter: `booking_id=eq.<bookingId>` }, …)`;
 *   2. a real customer session, so `auth.uid()` matches `bookings.user_id` and
 *      the RLS policy lets the subscription through;
 *   3. merging streamed rows onto this server-rendered list.
 */

/** Human-readable label per `event_type`. */
const LABELS: Record<string, string> = {
  "booking.created": "Booking created",
  "booking.payment_authorized": "Payment authorized",
  "booking.agent_assigned": "Agent assigned",
  "booking.verified_sealed": "ID verified, bags sealed",
  "booking.awaiting_pickup": "Ready for pickup",
  "booking.in_transit": "Driver collected your bags",
  "booking.delivered_to_bagdrop": "Delivered to your airline's bag drop",
  "booking.completed": "Complete",
  "booking.exception_raised": "Issue raised — ops is on it",
  "booking.exception_resolved_resumed": "Issue resolved, back in transit",
  "booking.exception_resolved_completed": "Issue resolved, delivered",
  "booking.cancelled": "Cancelled",
  "booking.correction": "Record corrected",
};

function labelFor(eventType: string): string {
  return LABELS[eventType] ?? eventType;
}

/**
 * `tz` is required, not defaulted: these timestamps sit next to the pickup
 * window on the same page, and a custody trail rendered in a different zone
 * would make the hand-offs look like they happened at the wrong time relative
 * to the visit the customer is reading about.
 */
export function CustodyTimeline({
  events,
  tz,
}: {
  events: CustodyEvent[];
  tz: string;
}) {
  return (
    <CustodyTimelineView
      items={events.map((event, i) => ({
        id: event.id,
        title: labelFor(event.eventType),
        badge: event.actorRole ? (
          <Badge variant="outline" className="text-[10px]">
            {event.actorRole}
          </Badge>
        ) : undefined,
        meta: formatInstantInAirportTz(event.createdAt, tz),
        metaDateTime: event.createdAt.toISOString(),
        photoUrl: event.photoUrl ?? undefined,
        photoAlt: `Evidence for ${labelFor(event.eventType)}`,
        state: i === events.length - 1 ? "current" : "complete",
      }))}
    />
  );
}
