"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  Button,
  ConfirmDialog,
  FormMessage,
  Input,
  Label,
  Select,
  usePreservedFormValues,
} from "@koolee/ui";

import { addZones, removeZone, type ZoneActionState } from "./actions";

export interface ZoneAgentOption {
  userId: string;
  label: string;
}

export function AddZonesForm({ agents }: { agents: ZoneAgentOption[] }) {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    addZones,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active agents yet — invite one on the Staff page first.
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zone-agent">Agent</Label>
        <Select id="zone-agent" name="agentUserId" required>
          {agents.map((agent) => (
            <option key={agent.userId} value={agent.userId}>
              {agent.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zone-zips">ZIPs</Label>
        <Input
          id="zone-zips"
          name="zips"
          required
          placeholder="11201, 11215 11217"
          aria-describedby="zone-zips-hint"
        />
        <span id="zone-zips-hint" className="text-xs text-muted-foreground">
          Commas or spaces. ZIPs outside the service area are refused.
        </span>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
      <Button type="submit" loading={pending}>
        Add ZIPs
      </Button>
    </form>
  );
}

/**
 * Taking a ZIP off an agent — behind a confirm.
 *
 * IT WAS A BARE "×" ON A CHIP, in a row of eight or ten identical chips, at
 * `h-6 px-1.5`. One mis-aimed click silently narrowed an agent's coverage, and
 * the only way to notice was that auto-assign quietly stopped picking them for
 * a neighbourhood. Nothing on the page said what had changed.
 *
 * The dialog NAMES BOTH the ZIP and the agent, because the row is dense enough
 * that "are you sure?" would leave somebody checking which chip they had
 * actually hit. `ConfirmDialog` is the app's existing pattern for exactly this
 * — see its own header: never fire an irreversible action from a bare button.
 *
 * It is not destructive in the red sense (re-adding a ZIP is one form away),
 * so the confirm is styled ordinary rather than as a warning. The cost is a
 * dispatcher's afternoon, not a lost record.
 */
export function RemoveZoneButton({
  agentUserId,
  zip,
  agentName,
}: {
  agentUserId: string;
  zip: string;
  /** Named in the dialog. Falls back to a generic phrase when unknown. */
  agentName?: string | null;
}) {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    removeZone,
    {},
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form action={formAction} ref={formRef} className="inline">
      <input type="hidden" name="agentUserId" value={agentUserId} />
      <input type="hidden" name="zip" value={zip} />
      <ConfirmDialog
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={pending}
            aria-label={`Remove ZIP ${zip}`}
            title={state.error ?? `Remove ${zip}`}
            className="h-6 px-1.5 font-mono text-xs"
          >
            {`${zip} ×`}
          </Button>
        }
        title={`Remove ${zip}?`}
        description={
          <>
            {agentName ?? "This agent"} will no longer cover <strong>{zip}</strong>.
            Auto-assign stops picking them for it; bookings already assigned are
            untouched. You can add it back at any time.
          </>
        }
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </form>
  );
}
