"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * US phone entry. The component displays "(212) 555-0100" while the parent
 * holds bare national digits; `toE164` normalizes for the auth API.
 */

/** Strips formatting; tolerates a leading US country code. Max 10 digits. */
export function normalizeUsPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function formatUsPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A stored E.164 number, rendered the way a person reads it aloud.
 *
 * The inverse of `toE164`, and the counterpart to `formatUsPhone` for values
 * that come back OUT of the database rather than in from a field. Promoted
 * here on 2026-08-29 when the agent app needed it too — admin's booking page
 * had the only copy, and a second one would have drifted.
 *
 * Anything that is not an unambiguous US number is returned untouched. That
 * matters more than it looks: without the `+` guard, a truncated
 * "+1212555010" formats as "(121) 255-5010", a plausible number that is not
 * the customer's — on screens whose whole purpose is that somebody dials it.
 */
export function formatE164ForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+1") && digits.length === 11) return formatUsPhone(digits.slice(1));
  if (!value.startsWith("+") && digits.length === 10) return formatUsPhone(digits);
  return value;
}

/** E.164 for a complete US number, else null. */
export function toE164(digits: string): string | null {
  return digits.length === 10 ? `+1${digits}` : null;
}

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Bare national digits, e.g. "2125550100". */
  value: string;
  onValueChange: (digits: string) => void;
  invalid?: boolean;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onValueChange, invalid, className, ...props }, ref) => {
    return (
      <div
        className={cn(
          "flex h-12 w-full items-stretch overflow-hidden rounded-lg border bg-white",
          "shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring",
          "focus-within:ring-offset-2",
          invalid ? "border-destructive" : "border-input",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="flex select-none items-center border-r border-input bg-muted px-3.5 text-sm font-medium text-navy-700"
        >
          +1
        </span>
        <input
          ref={ref}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(212) 555-0100"
          value={formatUsPhone(value)}
          onChange={(e) => onValueChange(normalizeUsPhone(e.target.value))}
          aria-invalid={invalid || undefined}
          className={cn(
            "w-full bg-transparent px-3.5 text-base text-navy-900 placeholder:text-muted-foreground",
            "focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          )}
          {...props}
        />
      </div>
    );
  },
);
PhoneInput.displayName = "PhoneInput";

export { PhoneInput };
