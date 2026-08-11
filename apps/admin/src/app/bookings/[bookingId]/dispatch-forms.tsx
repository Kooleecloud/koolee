"use client";

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
        <Select id="resolution" name="resolution" required defaultValue="cancel_and_refund">
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
      <Button type="submit" variant="destructive" loading={pending} className="self-start">
        Resolve exception
      </Button>
    </form>
  );
}
