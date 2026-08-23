"use client";

import { useActionState } from "react";
import {
  Button,
  FormMessage,
  Input,
  Label,
  Spinner,
  usePreservedFormValues,
} from "@koolee/ui";

import { addZones, removeZone, type ZoneActionState } from "./actions";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

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
        <select id="zone-agent" name="agentUserId" required className={selectClassName}>
          {agents.map((agent) => (
            <option key={agent.userId} value={agent.userId}>
              {agent.label}
            </option>
          ))}
        </select>
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
      <Button type="submit">{pending ? <Spinner /> : "Add ZIPs"}</Button>
    </form>
  );
}

export function RemoveZoneButton({
  agentUserId,
  zip,
}: {
  agentUserId: string;
  zip: string;
}) {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    removeZone,
    {},
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="agentUserId" value={agentUserId} />
      <input type="hidden" name="zip" value={zip} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove ZIP ${zip}`}
        title={state.error ?? `Remove ${zip}`}
        className="h-6 px-1.5 font-mono text-xs"
      >
        {pending ? <Spinner className="size-3" /> : `${zip} ×`}
      </Button>
    </form>
  );
}
