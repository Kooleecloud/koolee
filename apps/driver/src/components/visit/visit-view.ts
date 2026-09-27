import {
  VISIT_EXCEPTION_REASONS,
  type VisitDetail,
  type VisitExceptionReason,
} from "@koolee/api-contract";

import { formatInstant, iso } from "../../lib/time";

/**
 * The visit flow's view of a task, built the way the web page builds it
 * (apps/agent `tasks/[taskId]/page.tsx` L468-497): a few flags derived from
 * server state and nothing else. Pure, so the derivation is unit-tested here
 * and the screen only draws.
 */

export interface VisitBagView {
  id: string;
  /** The bag's number within the booking — matches the physical tag. */
  ordinal: number;
  sealId: string | null;
  weightKg: string | null;
  photoCount: number;
}

export interface VisitAgreementView {
  accepted: boolean;
  /** Null only when no agreement has ever been published. */
  version: number | null;
  /** Preformatted in the BOOKING's zone, never the device's. */
  acceptedAtLabel: string | null;
}

export interface VisitPassportView {
  status: "pending" | "customer_uploaded" | "agent_confirmed" | "failed";
  /** Short-TTL signed URL, minted server-side. Null when there is no photo. */
  photoUrl: string | null;
}

export interface VisitView {
  taskId: string;
  bookingId: string;
  paxName: string;
  bookingStatus: string;
  arrived: boolean;
  /** Both halves of the identity gate hold. Sealing is locked until they do. */
  identityPassed: boolean;
  agreement: VisitAgreementView;
  passport: VisitPassportView;
  bags: VisitBagView[];
  done: boolean;
  exception: boolean;
}

/** The custody event that marks the start of a visit — core's VISIT_EVENT_TYPES.arrived. */
export const VISIT_ARRIVED_EVENT = "visit.arrived";

/** The slice of `VisitDetail` the view reads — a Pick so tests need not fake a whole row. */
export type VisitViewSource = {
  task: Pick<VisitDetail["task"], "id" | "status">;
  booking: Pick<VisitDetail["booking"], "id" | "paxName" | "status">;
  bags: readonly Pick<
    VisitDetail["bags"][number],
    "id" | "ordinal" | "sealId" | "weightKg" | "photoUrls"
  >[];
  timeline: readonly Pick<VisitDetail["timeline"][number], "eventType">[];
  identityGate: VisitDetail["identityGate"];
  passportPhotoUrl: string | null;
  tz: string;
};

export function visitViewFrom(detail: VisitViewSource): VisitView {
  const gate = detail.identityGate;
  return {
    taskId: detail.task.id,
    bookingId: detail.booking.id,
    paxName: detail.booking.paxName,
    bookingStatus: detail.booking.status,
    arrived: detail.timeline.some((e) => e.eventType === VISIT_ARRIVED_EVENT),
    identityPassed: gate.passed,
    agreement: {
      accepted: gate.agreement.accepted,
      version:
        gate.agreement.acceptedVersion?.version ??
        gate.agreement.currentVersion?.version ??
        null,
      acceptedAtLabel: gate.agreement.acceptance
        ? formatInstant(iso(gate.agreement.acceptance.acceptedAt), detail.tz)
        : null,
    },
    passport: {
      status: gate.passport?.status ?? "pending",
      photoUrl: detail.passportPhotoUrl,
    },
    bags: detail.bags.map((bag) => ({
      id: bag.id,
      ordinal: bag.ordinal,
      sealId: bag.sealId,
      weightKg: bag.weightKg,
      photoCount: bag.photoUrls.length,
    })),
    done: detail.task.status === "done",
    exception: detail.booking.status === "exception" || detail.task.status === "failed",
  };
}

export function allSealed(view: Pick<VisitView, "bags">): boolean {
  return view.bags.every((bag) => bag.sealId);
}

export function sealedCount(view: Pick<VisitView, "bags">): number {
  return view.bags.filter((bag) => bag.sealId).length;
}

/** The web's `<option>`s, in the same order, keyed to the contract's enum. */
export const VISIT_EXCEPTION_OPTIONS: readonly {
  value: VisitExceptionReason;
  label: string;
}[] = [
  { value: "customer_not_home", label: "Customer not home" },
  { value: "customer_id_mismatch", label: "ID doesn't match the ticket" },
  { value: "bags_refused", label: "Bags can't be accepted" },
  { value: "unsafe_conditions", label: "Unsafe conditions" },
  { value: "other", label: "Something else" },
];

export const DEFAULT_VISIT_EXCEPTION_REASON: VisitExceptionReason =
  VISIT_EXCEPTION_REASONS[0];
