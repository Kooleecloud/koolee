"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "../lib/utils";

export interface NumberStepperProps {
  /** Form field name. Posts the current count as a plain integer string. */
  name: string;
  id?: string;
  defaultValue?: number;
  min?: number;
  max?: number;
  /** Accessible description of the thing being counted, e.g. "bags". */
  unit: string;
  /**
   * Id of the visible label. A stepper has no single labelable control, so
   * it is a labelled group rather than something a `htmlFor` can point at.
   */
  labelledBy?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Increment/decrement counter, replacing a select for small integer ranges.
 *
 * The count is a hidden input so the surrounding form contract is unchanged.
 * The visible readout is `aria-live` so assistive tech hears the new total
 * after a press, and the buttons carry explicit labels rather than relying on
 * the glyphs.
 */
function NumberStepper({
  name,
  id,
  defaultValue = 1,
  min = 1,
  max = 20,
  unit,
  labelledBy,
  className,
  disabled,
}: NumberStepperProps) {
  const [count, setCount] = React.useState(() =>
    Math.min(Math.max(defaultValue, min), max),
  );

  const step = (delta: number) =>
    setCount((current) => Math.min(Math.max(current + delta, min), max));

  const buttonClass = cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md border",
    "border-input bg-background text-navy-800 transition-colors",
    "hover:border-sky-400 hover:bg-accent/10",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-40",
  );

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      id={id}
      role="group"
      aria-labelledby={labelledBy}
    >
      <input type="hidden" name={name} value={count} readOnly />
      <button
        type="button"
        className={buttonClass}
        onClick={() => step(-1)}
        disabled={disabled || count <= min}
        aria-label={`Remove one of the ${unit}`}
      >
        <Minus aria-hidden className="size-4" />
      </button>
      <output
        aria-live="polite"
        className="min-w-16 text-center text-base font-medium text-navy-800 tabular-nums"
      >
        {count} {count === 1 ? unit.replace(/s$/, "") : unit}
      </output>
      <button
        type="button"
        className={buttonClass}
        onClick={() => step(1)}
        disabled={disabled || count >= max}
        aria-label={`Add one more of the ${unit}`}
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export { NumberStepper };
