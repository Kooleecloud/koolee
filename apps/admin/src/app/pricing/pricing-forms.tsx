"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, FormMessage, Input, Label } from "@koolee/ui";

import {
  publishPricingRuleAction,
  reactivatePricingRuleAction,
  type PricingActionState,
} from "./actions";

export interface PricingRuleFormValues {
  name: string;
  /** Dollars, as typed. */
  baseFee: string;
  perBag: string;
  /** Cents per kilometre. */
  perKm: string;
  /** One step per line: `<hours> <multiplier>`. */
  leadTimeCurve: string;
  /** JSON, because a discount rule is a union and there are four shapes. */
  discountRules: string;
}

/**
 * The editor.
 *
 * Pre-filled from the ACTIVE rule, so the ordinary change is "edit one number
 * and publish" rather than retyping five. The name is pre-filled with a
 * suggestion rather than the old name: two rules called `launch-v1` in the
 * history is a list nobody can read.
 */
export function PublishPricingRuleForm({
  defaults,
}: {
  defaults: PricingRuleFormValues;
}) {
  const [state, formAction, pending] = useActionState<PricingActionState, FormData>(
    publishPricingRuleAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-name">Name this version</Label>
        <Input
          id="rule-name"
          name="name"
          defaultValue={defaults.name}
          required
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">
          How you will recognise it in the history below. A date and what changed beats a
          version number.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-base">Base fee ($)</Label>
          <Input
            id="rule-base"
            name="baseFee"
            inputMode="decimal"
            defaultValue={defaults.baseFee}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-bag">Per bag ($)</Label>
          <Input
            id="rule-bag"
            name="perBag"
            inputMode="decimal"
            defaultValue={defaults.perBag}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-km">Per km (¢)</Label>
          <Input
            id="rule-km"
            name="perKm"
            inputMode="decimal"
            defaultValue={defaults.perKm}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-curve">Lead-time curve</Label>
        <textarea
          id="rule-curve"
          name="leadTimeCurve"
          rows={4}
          defaultValue={defaults.leadTimeCurve}
          spellCheck={false}
          className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        />
        <p className="text-xs text-muted-foreground">
          One step per line: <span className="font-mono">hours multiplier</span>. A window
          whose END is within that many hours of departure gets the multiplier; the
          smallest matching step wins, and no match is the base price.{" "}
          <span className="font-mono">10 1.4</span> means &ldquo;inside 10 hours,
          ×1.4&rdquo;.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-discounts">Discount rules (JSON)</Label>
        <textarea
          id="rule-discounts"
          name="discountRules"
          rows={6}
          defaultValue={defaults.discountRules}
          spellCheck={false}
          className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        />
        <p className="text-xs text-muted-foreground">
          Four shapes: <span className="font-mono">percent_off</span>,{" "}
          <span className="font-mono">flat_off_cents</span>,{" "}
          <span className="font-mono">senior</span>,{" "}
          <span className="font-mono">family</span>. Validated against the pricing
          engine&rsquo;s own schema before anything is written.
        </p>
      </div>

      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
      {state.ok ? <FormMessage variant="success">{state.ok}</FormMessage> : null}

      <Button type="submit" loading={pending}>
        Publish this rule
      </Button>
      <p className="text-xs text-muted-foreground">
        Publishing takes effect on the next quote. Bookings already made keep the price
        they were sold at — the charge and its breakdown live on the booking.
      </p>
    </form>
  );
}

/** One-click undo: make a previous rule the active one again. */
export function ReactivateRuleForm({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState<PricingActionState, FormData>(
    reactivatePricingRuleAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Make {name} live again
      </Button>
      {state.error ? <FormMessage variant="error">{state.error}</FormMessage> : null}
    </form>
  );
}
