import { Badge, type BadgeProps } from "./badge";

/*
 * One rendering of booking status for all three apps — friendly label plus
 * a severity-mapped variant. Keys mirror @koolee/core's BookingStatus (ui
 * deliberately does not depend on core); unknown statuses degrade to a
 * humanized secondary badge instead of crashing, so a new core status can
 * ship before this map learns its label.
 */

const STATUS: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  draft: { label: "Awaiting payment", variant: "secondary" },
  paid: { label: "Booked", variant: "default" },
  agent_assigned: { label: "Agent assigned", variant: "default" },
  verified_sealed: { label: "Verified and sealed", variant: "default" },
  awaiting_pickup: { label: "Ready for pickup", variant: "default" },
  in_transit: { label: "On the way to the airport", variant: "default" },
  delivered_to_bagdrop: { label: "Delivered to bag drop", variant: "success" },
  completed: { label: "Complete", variant: "success" },
  exception: { label: "Needs attention", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export interface BookingStatusBadgeProps {
  status: string;
  className?: string;
}

function BookingStatusBadge({ status, className }: BookingStatusBadgeProps) {
  const entry = STATUS[status] ?? {
    label: status.replaceAll("_", " "),
    variant: "secondary" as const,
  };
  return (
    <Badge variant={entry.variant} className={className}>
      {entry.label}
    </Badge>
  );
}

export { BookingStatusBadge };
