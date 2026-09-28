import {
  PICKUP_EXCEPTION_REASONS,
  type PickupDetail,
  type PickupExceptionReason,
} from "@koolee/api-contract";

/**
 * The pickup flow's view of a task, built the way the web page builds it
 * (apps/agent `tasks/[taskId]/page.tsx`): a few flags derived from server
 * state and nothing else. Pure, so the derivation is unit-tested here and the
 * screen only draws.
 */

export interface PickupBagView {
  id: string;
  /** The bag's number within the booking — matches the physical tag. */
  ordinal: number;
  sealId: string | null;
  scanned: boolean;
}

export interface PickupView {
  taskId: string;
  paxName: string;
  bookingRef: string;
  bookingStatus: string;
  departureAirport: string;
  /** The truck this run belongs to. Null when no driver has been chosen. */
  truckName: string | null;
  travelStarted: boolean;
  bags: PickupBagView[];
  done: boolean;
  exception: boolean;
}

/** The slice of `PickupDetail` the view reads — a Pick so tests need not fake a whole row. */
export type PickupViewSource = {
  task: Pick<PickupDetail["task"], "id" | "status" | "startedAt">;
  booking: Pick<
    PickupDetail["booking"],
    "paxName" | "ref" | "status" | "departureAirport"
  >;
  bags: readonly Pick<PickupDetail["bags"][number], "id" | "ordinal" | "sealId">[];
  scannedBagIds: readonly string[];
  shift: Pick<NonNullable<PickupDetail["shift"]>, "truckName"> | null;
};

export function pickupViewFrom(detail: PickupViewSource): PickupView {
  return {
    taskId: detail.task.id,
    paxName: detail.booking.paxName,
    bookingRef: detail.booking.ref,
    bookingStatus: detail.booking.status,
    departureAirport: detail.booking.departureAirport,
    truckName: detail.shift?.truckName ?? null,
    travelStarted: detail.task.startedAt !== null,
    bags: detail.bags.map((bag) => ({
      id: bag.id,
      ordinal: bag.ordinal,
      sealId: bag.sealId,
      scanned: detail.scannedBagIds.includes(bag.id),
    })),
    done: detail.task.status === "done",
    exception: detail.booking.status === "exception" || detail.task.status === "failed",
  };
}

export function scannedCount(view: Pick<PickupView, "bags">): number {
  return view.bags.filter((bag) => bag.scanned).length;
}

export function isDelivered(view: Pick<PickupView, "bookingStatus">): boolean {
  return (
    view.bookingStatus === "delivered_to_bagdrop" || view.bookingStatus === "completed"
  );
}

/** The web's `EXCEPTION_REASONS`, in the same order, keyed to the contract's enum. */
export const PICKUP_EXCEPTION_OPTIONS: readonly {
  value: PickupExceptionReason;
  label: string;
}[] = [
  { value: "seal_mismatch", label: "A seal doesn't match the booking" },
  { value: "bag_count_mismatch", label: "Wrong number of bags at the door" },
  { value: "customer_not_home", label: "Nobody at the address" },
  { value: "vehicle_problem", label: "Vehicle problem" },
  { value: "bagdrop_refused", label: "Bag drop refused the bags" },
  { value: "other", label: "Something else" },
];

export const DEFAULT_PICKUP_EXCEPTION_REASON: PickupExceptionReason =
  PICKUP_EXCEPTION_REASONS[0];
