import { Avatar, Badge } from "@koolee/ui";
import type { CustodyTimelineItem } from "@koolee/ui";
import { formatInstantInAirportTz, type CustodyEvent } from "@koolee/core";

import { CustodyTrail } from "./custody-trail";

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
  // Found unlabelled during the driver slice's browser pass: five money and
  // dispatch events were rendering as raw tokens ("booking.payment_captured")
  // on a customer's own timeline, next to labelled ones. Nothing to do with
  // drivers — just visible for the first time on a page being read closely.
  "booking.payment_captured": "Payment taken",
  "booking.payment_refunded": "Payment refunded",
  "booking.payment_auth_cancelled": "Card hold released",
  "booking.payment_unwind_failed": "Refund needs a human — we're on it",
  "booking.agent_assigned": "Agent assigned",
  "booking.agent_reassigned": "A different agent took your pickup",
  // Adjacent one-liners: these three were already rendering as raw event
  // names ("visit.arrived") on the customer's own timeline, and the new
  // passport rows made that sit right next to labelled ones.
  "visit.arrived": "Your agent arrived",
  "visit.identity_verified": "Your agent checked your ID",
  "bag.sealed": "Bag sealed and photographed",
  "agreement.accepted": "You accepted the booking agreement",
  "passport.customer_uploaded": "You added a passport photo",
  "passport.agent_captured": "Your agent photographed your passport",
  "passport.agent_confirmed": "Your agent confirmed your passport",
  "booking.verified_sealed": "ID verified, bags sealed",
  // The driver half of the run. Customer voice throughout: "your driver",
  // never a shift id or a truck name — those are ops vocabulary and they are
  // in the event metadata for the console to render.
  "pickup.driver_selected": "You chose your driver",
  "pickup.driver_released": "You changed driver",
  "pickup.travel_started": "Your driver is on the way",
  "pickup.seal_scanned": "Seal checked at your door",
  "pickup.seal_mismatch": "A seal didn't match — ops is on it",
  "pickup.shift_force_ended": "Reassigning your driver",
  "pickup.reassigned": "Your driver changed",
  // The customer's wording, not ops'. "Unassigned" describes our queue; what
  // happened to THEM is that the driver they had is no longer coming and they
  // get to pick again — which is also what the page will now offer.
  "pickup.unassigned": "Choosing a new driver for you",
  "pickup.handover_confirmed": "Your airline took your bags",
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

/** Who to name and show a face for, keyed by the actor's user id. */
export interface TimelineActor {
  name: string;
  avatarUrl: string | null;
}

/**
 * The events worth putting a face on.
 *
 * NOT EVERY EVENT WITH AN ACTOR. A customer's own actions ("You accepted the
 * booking agreement") do not need their own photograph, and back-office staff
 * are not people the customer is going to meet. These five are the moments
 * where the answer to "who?" is somebody who will be standing at the door or
 * driving away with the bags — the only ones where a name and a face change
 * what the reader knows.
 */
const NAMED_EVENTS = new Set([
  "booking.agent_assigned",
  "booking.agent_reassigned",
  "pickup.driver_selected",
  "pickup.reassigned",
  "pickup.travel_started",
]);

/**
 * WHO THE EVENT IS ABOUT — which is very often not who performed it.
 *
 * The first version of this read `actor_user_id` and produced a nameless
 * "Agent assigned" on a real booking, because the actor there is the ADMIN who
 * made the assignment (or nobody at all, for the auto-assign on paid). The
 * person the customer cares about is the one being assigned, and dispatch puts
 * them in the metadata: `agentUserId` on both assignment events,
 * `driverUserId` on driver selection.
 *
 * Falls back to the actor, which is correct for the events where the two are
 * the same person — `pickup.travel_started` is the driver saying they have set
 * off.
 *
 * Found by opening a real trip page; no test had a fixture where the actor and
 * the subject differed.
 */
function subjectOf(event: CustodyEvent): string | null {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  for (const key of ["agentUserId", "driverUserId"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return event.actorUserId ?? null;
}

/** How many events to show before the trail is folded away. */
const COLLAPSED_COUNT = 3;

/**
 * A SERVER COMPONENT, deliberately, and it stayed one at some cost.
 *
 * Everything here needs `@koolee/core` — the airport-zone formatter above all
 * — and core's barrel reaches `@koolee/db` and then `postgres`. Marking this
 * file `"use client"` to get `useState` for the collapse therefore drags a
 * Postgres driver into the browser bundle and 500s the trip page at request
 * time, which typecheck cannot see and which cost one such 500 to find.
 *
 * So the mapping stays here and the collapse lives in `CustodyTrail`, which
 * imports nothing but the UI kit. Finished items cross the boundary as props.
 */
export function CustodyTimeline({
  events,
  tz,
  signedUrls,
  actors,
}: {
  events: CustodyEvent[];
  /**
   * Required, not defaulted: these timestamps sit next to the pickup window on
   * the same page, and a trail rendered in a different zone would make the
   * hand-offs look like they happened at the wrong time relative to the visit
   * the customer is reading about.
   */
  tz: string;
  /**
   * actor user id → name and avatar, for the events in `NAMED_EVENTS`.
   * Resolved and signed on the server; an id that is not here renders as it
   * always did.
   */
  actors?: Map<string, TimelineActor>;
  /**
   * storage path → signed URL, from `signBagPhotoUrls`.
   *
   * Required, not optional: `event.photoUrl` is a path into the PRIVATE
   * bag-photos bucket, so passing it straight to an <img> renders a broken
   * image. An event whose path is not in the map renders without its photo
   * rather than with a broken one.
   */
  signedUrls: Map<string, string>;
}) {
  const items: CustodyTimelineItem[] = events.map((event) => {
    const subjectId = NAMED_EVENTS.has(event.eventType) ? subjectOf(event) : null;
    const actor = subjectId ? actors?.get(subjectId) : undefined;
    return {
      id: event.id,
      title: labelFor(event.eventType),
      badge: event.actorRole ? (
        <Badge variant="outline" className="text-[10px]">
          {event.actorRole}
        </Badge>
      ) : undefined,
      meta: formatInstantInAirportTz(event.createdAt, tz),
      metaDateTime: event.createdAt.toISOString(),
      photoUrl: event.photoUrl ? signedUrls.get(event.photoUrl) : undefined,
      photoAlt: `Evidence for ${labelFor(event.eventType)}`,
      /* A trail read for its sequence, not scanned for its photos. */
      photoAsButton: true,
      ...(actor
        ? {
            actor: {
              name: actor.name,
              avatar: <Avatar size="sm" name={actor.name} src={actor.avatarUrl} alt="" />,
            },
          }
        : {}),
      /* "Current" is the newest event on the WHOLE trail, not the newest one
         on screen — collapsing must not move the marker. */
      state: event.id === events[events.length - 1]?.id ? "current" : "complete",
    };
  });

  return <CustodyTrail items={items} collapsedCount={COLLAPSED_COUNT} />;
}
