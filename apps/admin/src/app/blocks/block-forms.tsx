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

import { createBlock, removeBlock, type BlockActionState } from "./actions";

/** 12-hour label for an hour-of-day select option. */
const hourLabel = (hour: number) =>
  `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? "AM" : "PM"}`;

export function CreateBlockForm() {
  const [state, formAction, pending] = useActionState<BlockActionState, FormData>(
    createBlock,
    {},
  );
  const { formRef, captureValues } = usePreservedFormValues(state);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={captureValues}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-airport">Airport</Label>
        <Select id="block-airport" name="airportCode" required defaultValue="JFK">
          <option value="JFK">JFK</option>
          <option value="LGA">LGA</option>
          <option value="EWR">EWR</option>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-day">Date</Label>
        <Input id="block-day" name="day" type="date" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-start">First blocked hour</Label>
        <Select id="block-start" name="startHour" required defaultValue="9">
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hourLabel(hour)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-hours">Length</Label>
        <Select id="block-hours" name="hours" required defaultValue="1">
          {Array.from({ length: 24 }, (_, i) => i + 1).map((hours) => (
            <option key={hours} value={hours}>
              {hours} {hours === 1 ? "hour" : "hours"}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-reason">Reason (optional)</Label>
        <Input
          id="block-reason"
          name="reason"
          placeholder="No drivers / weather / holiday"
          maxLength={200}
        />
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
      <Button type="submit" loading={pending}>
        Block windows
      </Button>
    </form>
  );
}

export function RemoveBlockButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<BlockActionState, FormData>(
    removeBlock,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Remove
      </Button>
      {state.error ? (
        <FormMessage className="px-2 py-1 text-xs">{state.error}</FormMessage>
      ) : null}
    </form>
  );
}
