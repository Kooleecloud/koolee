import { format } from "date-fns";
import { Badge } from "@koolee/ui";
import type { CustodyEvent } from "@koolee/core";

/**
 * Chain-of-custody timeline.
 *
 * Server-rendered from `custody_events`, which is append-only — so this is a
 * faithful record, not a summary that could drift from what happened.
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

export function CustodyTimeline({ events }: { events: CustodyEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has happened yet. Events appear here as your bags move.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {events.map((event, i) => {
        const isLast = i === events.length - 1;
        return (
          <li key={event.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={
                  isLast
                    ? "mt-1.5 size-2.5 rounded-full bg-primary ring-4 ring-primary/20"
                    : "mt-1.5 size-2.5 rounded-full bg-muted-foreground/40"
                }
              />
              {!isLast && <span className="w-px flex-1 bg-border" />}
            </div>

            <div className="flex flex-1 flex-col gap-1 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{labelFor(event.eventType)}</span>
                {event.actorRole && (
                  <Badge variant="outline" className="text-[10px]">
                    {event.actorRole}
                  </Badge>
                )}
              </div>
              <time
                dateTime={event.createdAt.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {format(event.createdAt, "EEE d MMM, h:mm a")}
              </time>
              {event.photoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.photoUrl}
                  alt={`Evidence for ${labelFor(event.eventType)}`}
                  className="mt-1 max-w-48 rounded-md border"
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
