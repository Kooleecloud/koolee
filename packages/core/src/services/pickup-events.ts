/**
 * Custody event names for the driver / pickup slice.
 *
 * One module so the three services that write them (`shifts.ts`,
 * `driver-selection.ts`, `pickup.ts`) and the two consoles that render them
 * (`apps/admin/src/lib/custody-copy.ts`, `apps/web`'s timeline) share one
 * spelling. A typo in an event name is invisible: nothing fails, the event
 * simply never matches a copy entry and renders as a raw string forever.
 *
 * `custody_events.event_type` is deliberately free text rather than an enum
 * (see `schema/custody.ts`) so a new name never needs a migration — which
 * makes THIS file the only thing keeping the vocabulary honest.
 *
 * The booking's own lifecycle events (`booking.awaiting_pickup`,
 * `booking.in_transit`, `booking.delivered_to_bagdrop`, `booking.completed`)
 * are NOT here: they belong to the state machine and are written by
 * `applyTransition`. Never emit one of those by hand.
 */
export const PICKUP_EVENT_TYPES = {
  /** The customer chose this driver. Metadata: shift, truck, ETA, zone. */
  driver_selected: "pickup.driver_selected",
  /** A previous driver was released, because the customer chose again. */
  driver_released: "pickup.driver_released",
  /** The driver set off toward the door. */
  travel_started: "pickup.travel_started",
  /** One bag's seal matched at the door, per bag. */
  seal_scanned: "pickup.seal_scanned",
  /** A seal was presented that does not belong to this booking. */
  seal_mismatch: "pickup.seal_mismatch",
  /** The airline took the bags — the handover is confirmed. */
  handover_confirmed: "pickup.handover_confirmed",
  /** An admin force-ended a shift and this pickup went back in the pool. */
  shift_force_ended: "pickup.shift_force_ended",
  /** An admin moved this pickup to a different shift. */
  reassigned: "pickup.reassigned",
  /** An admin took the driver off this pickup, leaving it unassigned. */
  unassigned: "pickup.unassigned",
} as const;

export type PickupEventType =
  (typeof PICKUP_EVENT_TYPES)[keyof typeof PICKUP_EVENT_TYPES];
