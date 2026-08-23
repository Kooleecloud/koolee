import type { BookingStatus } from "@koolee/core";

/** Customer-facing labels for booking statuses, shared by the /trips pages. */
export const STATUS_LABEL: Record<BookingStatus, string> = {
  draft: "Awaiting payment",
  paid: "Booked",
  agent_assigned: "Agent assigned",
  verified_sealed: "Verified and sealed",
  awaiting_pickup: "Ready for pickup",
  in_transit: "On the way to the airport",
  delivered_to_bagdrop: "Delivered to bag drop",
  completed: "Complete",
  exception: "Needs attention",
  cancelled: "Cancelled",
};

export const STATUS_VARIANT: Record<
  BookingStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  draft: "secondary",
  paid: "default",
  agent_assigned: "default",
  verified_sealed: "default",
  awaiting_pickup: "default",
  in_transit: "default",
  delivered_to_bagdrop: "success",
  completed: "success",
  exception: "warning",
  cancelled: "destructive",
};
