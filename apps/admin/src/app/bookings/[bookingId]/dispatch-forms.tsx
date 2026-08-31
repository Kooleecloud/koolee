"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Button,
  FormMessage,
  Input,
  Label,
  Select,
  usePreservedFormValues,
} from "@koolee/ui";

import {
  assignAgent,
  autoAssign,
  reassignPickup,
  unassignPickup,
  resolveException,
  type DispatchActionState,
} from "../actions";

export interface AgentOption {
  userId: string;
  label: string;
}

/**
 * One-click "let the machine pick".
 *
 * Its own form, next to the manual picker rather than replacing it: the
 * operator can always overrule the choice, and a refusal (no ZIP coverage)
 * has to be readable right where they are about to assign by hand.
 */
export function AutoAssignButton({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<DispatchActionState, FormData>(
    autoAssign,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        Auto-assign
      </Button>
      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">{state.ok}</FormMessage>}
    </form>
  );
}

export function AssignAgentForm({
  bookingId,
  agents,
  currentAssignee,
}: {
  bookingId: string;
  agents: AgentOption[];
  currentAssignee: string | null;
}) {
  const [state, formAction, pending] = useActionState<DispatchActionState, FormData>(
    assignAgent,
    {},
  );

  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active agents to assign — invite one on the Staff page.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="grid gap-2">
        <Label htmlFor="agentUserId">Agent</Label>
        <Select
          id="agentUserId"
          name="agentUserId"
          defaultValue={currentAssignee ?? agents[0]?.userId}
          required
        >
          {agents.map((agent) => (
            <option key={agent.userId} value={agent.userId}>
              {agent.label}
            </option>
          ))}
        </Select>
      </div>
      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">{state.ok}</FormMessage>}
      <Button type="submit" loading={pending} className="self-start">
        {currentAssignee ? "Reassign" : "Assign"}
      </Button>
    </form>
  );
}

export function ResolveExceptionForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<DispatchActionState, FormData>(
    resolveException,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="grid gap-2">
        <Label htmlFor="resolution">Resolution</Label>
        <Select
          id="resolution"
          name="resolution"
          required
          defaultValue="cancel_and_refund"
        >
          <option value="cancel_and_refund">Cancel + refund the customer</option>
          <option value="resume_transit">Resolved — bags moving again</option>
          <option value="force_complete">Close out as completed</option>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reason">Reason (required, goes in the custody trail)</Label>
        <Input
          id="reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="what happened and why this resolution"
        />
      </div>
      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">{state.ok}</FormMessage>}
      <Button
        type="submit"
        variant="destructive"
        loading={pending}
        className="self-start"
      >
        Resolve exception
      </Button>
    </form>
  );
}

export interface ReassignOptionView {
  shiftId: string;
  label: string;
  inZone: boolean;
  hasRoom: boolean;
}

/**
 * Take the driver off a pickup, leaving it unassigned.
 *
 * THE MISSING HALF OF REASSIGN. Until now the console could only MOVE a
 * pickup from one shift to another, so an admin undoing an assignment — a
 * driver called in sick, a van broke down, the customer picked somebody who
 * then clocked off — had to park the booking on some other driver who was not
 * going to do it either. That is a lie told to the dispatch board, and the
 * board is what decides who gets chased.
 *
 * Two-step, like force-end, but for a lighter reason: this is not
 * destructive, it is just easy to hit by accident beside "Move". The reason
 * box is OPTIONAL — force-end's is required because it touches every booking
 * on a shift and strands bags; this touches one booking whose bags are still
 * at the customer's door.
 *
 * Core refuses it once the bags are IN the van (`in_transit` and beyond) and
 * says why, naming force-end as the honest route for that case.
 */
export function UnassignPickupForm({
  bookingId,
  driverLabel,
}: {
  bookingId: string;
  /** Who is on it now, for the confirmation line. */
  driverLabel: string;
}) {
  const [state, formAction, pending] = useActionState<DispatchActionState, FormData>(
    unassignPickup,
    {},
  );
  const [open, setOpen] = React.useState(false);

  if (state.ok) return <FormMessage variant="success">{state.ok}</FormMessage>;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setOpen(true)}
        >
          Remove driver
        </Button>
        {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm text-muted-foreground">
        Take {driverLabel} off this pickup? It goes back in the pool and shows on the
        board as awaiting a driver, and the customer can choose again.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`unassign-reason-${bookingId}`}>Reason (optional)</Label>
        <Input
          id={`unassign-reason-${bookingId}`}
          name="reason"
          maxLength={500}
          placeholder="Called in sick"
        />
      </div>
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" loading={pending}>
          Remove driver
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Move a pickup to a different shift.
 *
 * Only OPEN shifts are listed — a driver who is not out cannot take a run —
 * and each option says whether it would need the override, so an operator sees
 * the cost of a choice before making it rather than after being refused.
 */
export function ReassignPickupForm({
  bookingId,
  bagCount,
  currentShiftId,
  options,
}: {
  bookingId: string;
  bagCount: number;
  currentShiftId: string | null;
  options: ReassignOptionView[];
}) {
  const [state, formAction, pending] = useActionState<DispatchActionState, FormData>(
    reassignPickup,
    {},
  );

  const selectable = options.filter((option) => option.shiftId !== currentShiftId);

  if (selectable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {options.length === 0
          ? "Nobody is on shift. Drivers start their own shift in the field app; the Shifts page shows who is out."
          : "The only driver on shift already has this pickup."}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`shift-${bookingId}`}>Move to</Label>
        <Select
          id={`shift-${bookingId}`}
          name="shiftId"
          defaultValue={selectable[0]?.shiftId}
        >
          {selectable.map((option) => {
            const flags = [
              option.inZone ? null : "out of zone",
              option.hasRoom ? null : `under ${bagCount} bags of room`,
            ].filter(Boolean);
            return (
              <option key={option.shiftId} value={option.shiftId}>
                {option.label}
                {flags.length > 0 ? ` — ${flags.join(", ")}` : ""}
              </option>
            );
          })}
        </Select>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="override" className="mt-0.5" />
        <span>
          Override zone and capacity.{" "}
          <span className="text-muted-foreground">
            Recorded on the custody trail with the rule it waived.
          </span>
        </span>
      </label>

      {state.error && <FormMessage>{state.error}</FormMessage>}
      {state.ok && <FormMessage variant="success">{state.ok}</FormMessage>}

      <Button type="submit" variant="outline" loading={pending} className="self-start">
        Move pickup
      </Button>
    </form>
  );
}
