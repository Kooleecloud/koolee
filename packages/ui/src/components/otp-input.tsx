"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface OTPInputProps {
  /** Current code, digits only. */
  value: string;
  onChange: (code: string) => void;
  /** Fired once when all digits are filled. */
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Group label for assistive tech. */
  "aria-label"?: string;
  className?: string;
}

/**
 * Segmented one-time-code input. Types left to right, pastes a whole code,
 * backspaces across boxes. Digits only.
 */
function OTPInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus,
  invalid,
  "aria-label": ariaLabel = "One-time code",
  className,
}: OTPInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const completedFor = React.useRef<string | null>(null);

  const digits = value.replace(/\D/g, "").slice(0, length);

  React.useEffect(() => {
    if (digits.length === length && completedFor.current !== digits) {
      completedFor.current = digits;
      onComplete?.(digits);
    }
    if (digits.length < length) completedFor.current = null;
  }, [digits, length, onComplete]);

  const focusBox = (i: number) => {
    const box = refs.current[Math.max(0, Math.min(i, length - 1))];
    box?.focus();
    box?.select();
  };

  /** Insert incoming characters at box `i` (handles both typing and paste). */
  const handleInput = (i: number, incoming: string) => {
    const clean = incoming.replace(/\D/g, "");
    if (clean.length === 0) {
      // Character was deleted in place.
      const next = digits.slice(0, i) + digits.slice(i + 1);
      onChange(next);
      return;
    }
    const next = (digits.slice(0, i) + clean + digits.slice(i + clean.length)).slice(
      0,
      length,
    );
    onChange(next);
    focusBox(i + clean.length);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !e.currentTarget.value) {
      e.preventDefault();
      const next = digits.slice(0, Math.max(0, i - 1)) + digits.slice(i);
      onChange(next);
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(i + 1);
    }
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-2", className)}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={length}
          value={digits[i] ?? ""}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          onPaste={(e) => {
            e.preventDefault();
            handleInput(i, e.clipboardData.getData("text"));
          }}
          className={cn(
            "size-12 rounded-lg border bg-white text-center font-display text-xl",
            "font-semibold text-navy-900 shadow-sm transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-destructive" : "border-input",
          )}
        />
      ))}
    </div>
  );
}

export { OTPInput };
