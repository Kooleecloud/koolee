import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Styled native checkbox. Native on purpose, same reasoning as `Select`: it
 * carries indeterminate state, form participation, and platform keyboard
 * behavior for free, and needs no JS to work.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-4 shrink-0 cursor-pointer rounded-sm border border-input accent-primary transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

export interface CheckboxFieldProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: React.ReactNode;
  /** Secondary line under the label. */
  hint?: React.ReactNode;
  labelClassName?: string;
}

/**
 * Checkbox + clickable label as one unit. Wrapping in `<label>` rather than
 * pairing by id means the whole row is a hit target and callers never have to
 * mint unique ids for a list of options.
 */
const CheckboxField = React.forwardRef<HTMLInputElement, CheckboxFieldProps>(
  ({ label, hint, className, labelClassName, ...props }, ref) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 text-sm select-none",
        props.disabled && "cursor-not-allowed opacity-50",
        labelClassName,
      )}
    >
      <Checkbox ref={ref} className={cn("mt-0.5", className)} {...props} />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  ),
);
CheckboxField.displayName = "CheckboxField";

export { Checkbox, CheckboxField };
