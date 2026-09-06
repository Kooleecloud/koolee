"use client";

import * as React from "react";
import { useActionState } from "react";
import { Badge, Button, FormMessage, Input, Label, Select } from "@koolee/ui";

import {
  createCutoffAction,
  updateCutoffAction,
  type CutoffActionState,
} from "./actions";

export interface CutoffRowView {
  id: string;
  airlineIata: string;
  airportCode: string;
  scope: string;
  minutes: number;
  source: string | null;
  placeholder: boolean;
}

/**
 * One row, edited in place.
 *
 * The source field is REQUIRED and pre-filled empty on a placeholder row,
 * because "45" with no provenance is a number the next person has to verify
 * from scratch — which is the state all 128 rows start in. Core refuses to
 * save the seed's own placeholder text back, so the badge can only be cleared
 * by an actual answer.
 */
export function CutoffRowForm({ row }: { row: CutoffRowView }) {
  const [state, formAction, pending] = useActionState<CutoffActionState, FormData>(
    updateCutoffAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2 py-3">
      <input type="hidden" name="id" value={row.id} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{row.airlineIata}</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {row.scope}
        </Badge>
        {row.placeholder ? (
          <Badge variant="secondary" className="text-[10px]">
            Unverified
          </Badge>
        ) : (
          <Badge variant="success" className="text-[10px]">
            Verified
          </Badge>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`minutes-${row.id}`} className="text-xs">
            Minutes before
          </Label>
          <Input
            id={`minutes-${row.id}`}
            name="minutes"
            type="number"
            min={10}
            max={480}
            defaultValue={row.minutes}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`source-${row.id}`} className="text-xs">
            Where the number came from
          </Label>
          <Input
            id={`source-${row.id}`}
            name="source"
            // A placeholder row starts blank on purpose: nobody should be able
            // to save the seed's sentence back by pressing Save without
            // reading it.
            defaultValue={row.placeholder ? "" : (row.source ?? "")}
            placeholder="delta.com/baggage, checked 2026-09-01"
            maxLength={500}
            required
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={pending}>
          Save
        </Button>
      </div>

      {row.placeholder && row.source ? (
        <p className="text-xs text-muted-foreground">{row.source}</p>
      ) : null}
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}
    </form>
  );
}

/**
 * An airline the seed never knew about.
 *
 * Not a nicety: `resolveStrictestCutoffMinutes` REFUSES TO SELL when no row
 * exists for an airline at an airport, so a real carrier missing from the
 * matrix is a carrier Koolee cannot serve until somebody can add one without
 * a migration.
 */
export function AddCutoffForm() {
  const [state, formAction, pending] = useActionState<CutoffActionState, FormData>(
    createCutoffAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cutoff-airline">Airline (IATA)</Label>
          <Input
            id="new-cutoff-airline"
            name="airlineIata"
            placeholder="DL"
            maxLength={3}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cutoff-airport">Airport</Label>
          <Select id="new-cutoff-airport" name="airportCode" defaultValue="JFK">
            <option value="JFK">JFK</option>
            <option value="LGA">LGA</option>
            <option value="EWR">EWR</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cutoff-scope">Scope</Label>
          <Select id="new-cutoff-scope" name="scope" defaultValue="domestic">
            <option value="domestic">Domestic</option>
            <option value="international">International</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cutoff-minutes">Minutes before departure</Label>
          <Input
            id="new-cutoff-minutes"
            name="minutes"
            type="number"
            min={10}
            max={480}
            defaultValue={45}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-cutoff-source">Where the number came from</Label>
        <Input
          id="new-cutoff-source"
          name="source"
          placeholder="aa.com/baggage, checked 2026-09-01"
          maxLength={500}
          required
        />
      </div>

      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}

      <Button type="submit" loading={pending}>
        Add cutoff
      </Button>
    </form>
  );
}
