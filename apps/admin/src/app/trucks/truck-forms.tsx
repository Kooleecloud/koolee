"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, FormMessage, Input, Label } from "@koolee/ui";

import {
  createTruckAction,
  setTruckActiveAction,
  updateTruckAction,
  type TruckActionState,
} from "./actions";

export interface TruckRowView {
  id: string;
  name: string;
  bagCapacity: number;
  reservedSpaces: number;
  active: boolean;
  heldByName: string | null;
  bagsOnBoard: number;
}

export function AddTruckForm() {
  const [state, formAction, pending] = useActionState<TruckActionState, FormData>(
    createTruckAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-truck-name">Name</Label>
        <Input
          id="new-truck-name"
          name="name"
          placeholder="Van 3"
          required
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">
          Whatever a dispatcher and a driver say to each other. It has to be unique.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-truck-capacity">Bag capacity</Label>
          <Input
            id="new-truck-capacity"
            name="bagCapacity"
            type="number"
            min={1}
            max={500}
            defaultValue={20}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-truck-reserved">Reserved spaces</Label>
          <Input
            id="new-truck-reserved"
            name="reservedSpaces"
            type="number"
            min={0}
            max={500}
            defaultValue={0}
          />
          <p className="text-xs text-muted-foreground">
            Held back from booking capacity. Must be fewer than the capacity.
          </p>
        </div>
      </div>

      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}

      <Button type="submit" loading={pending}>
        Add truck
      </Button>
    </form>
  );
}

export function TruckRowForms({ truck }: { truck: TruckRowView }) {
  const [saveState, saveAction, saving] = useActionState<TruckActionState, FormData>(
    updateTruckAction,
    {},
  );
  const [toggleState, toggleAction, toggling] = useActionState<
    TruckActionState,
    FormData
  >(setTruckActiveAction, {});

  return (
    <div className="flex flex-col gap-3">
      <form action={saveAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={truck.id} />
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor={`name-${truck.id}`}>Name</Label>
          <Input id={`name-${truck.id}`} name="name" defaultValue={truck.name} required />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor={`capacity-${truck.id}`}>Bags</Label>
          <Input
            id={`capacity-${truck.id}`}
            name="bagCapacity"
            type="number"
            min={1}
            max={500}
            defaultValue={truck.bagCapacity}
            required
          />
        </div>
        <div className="flex w-32 flex-col gap-1.5">
          <Label htmlFor={`reserved-${truck.id}`}>Reserved</Label>
          <Input
            id={`reserved-${truck.id}`}
            name="reservedSpaces"
            type="number"
            min={0}
            max={500}
            defaultValue={truck.reservedSpaces}
          />
        </div>
        <Button type="submit" variant="outline" loading={saving}>
          Save
        </Button>
      </form>

      <form action={toggleAction}>
        <input type="hidden" name="id" value={truck.id} />
        <input type="hidden" name="active" value={truck.active ? "false" : "true"} />
        <Button
          type="submit"
          variant={truck.active ? "ghost" : "outline"}
          size="sm"
          loading={toggling}
        >
          {truck.active ? "Take out of service" : "Put back in service"}
        </Button>
      </form>

      {saveState.error ? (
        <FormMessage variant="error">{saveState.error}</FormMessage>
      ) : null}
      {saveState.ok ? <FormMessage variant="success">{saveState.ok}</FormMessage> : null}
      {/* The one refusal worth reading carefully: a truck that is out with a
          driver names them rather than saying "cannot deactivate". */}
      {toggleState.error ? (
        <FormMessage variant="error">{toggleState.error}</FormMessage>
      ) : null}
      {toggleState.ok ? (
        <FormMessage variant="success">{toggleState.ok}</FormMessage>
      ) : null}
    </div>
  );
}
