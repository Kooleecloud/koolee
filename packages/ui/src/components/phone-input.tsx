"use client";

import * as React from "react";

import { cn } from "../lib/utils";
/*
 * Imported, not defined here. They were defined in this file, which carries
 * `"use client"` — so a server component calling `formatE164ForDisplay` threw
 * at render time. See lib/phone.ts for the full story.
 */
import { formatUsPhone, normalizeUsPhone } from "../lib/phone";

/**
 * US phone entry. The component displays "(212) 555-0100" while the parent
 * holds bare national digits; `toE164` normalizes for the auth API.
 */

export interface PhoneInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
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
