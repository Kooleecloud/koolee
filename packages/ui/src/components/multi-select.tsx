"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { CheckboxField } from "./checkbox";

/**
 * Checkbox-list dropdown for filtering by several values at once.
 *
 * Built on `<details>`/`<summary>` rather than a popover library, for the same
 * reason `Select` is a native `<select>`: the disclosure, its focus behavior,
 * and Enter/Space toggling come from the platform. What the platform does NOT
 * give us is dismissal — a `<details>` stays open until you click the summary
 * again — so the only JS here closes it on outside-click and Escape.
 *
 * Selection is controlled. The component owns no filter state: the caller
 * decides what selection means (URL params, a form, local state), which is
 * what keeps it reusable across the boards that need it.
 */

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
  /** Secondary line under the label, e.g. a count or an explanation. */
  hint?: React.ReactNode;
  disabled?: boolean;
}

export interface MultiSelectProps {
  /** Field name shown before the summary, e.g. "Status". */
  label: React.ReactNode;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Summary text when nothing is ticked — "no constraint", not "none". */
  allLabel?: string;
  /** Overrides the default 0 / 1 / n summary text. */
  summarize?: (selected: string[], options: MultiSelectOption[]) => string;
  /** Label for the in-panel reset. Hidden when nothing is selected. */
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Panel width; defaults to matching the trigger. */
  panelClassName?: string;
}

function defaultSummary(selected: string[], options: MultiSelectOption[]): string {
  if (selected.length === 1) {
    const match = options.find((option) => option.value === selected[0]);
    // Only a string label can stand in for the summary; nodes fall back to n.
    if (typeof match?.label === "string") return match.label;
  }
  return `${selected.length} selected`;
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = "All",
  summarize = defaultSummary,
  clearLabel = "Clear",
  disabled = false,
  className,
  panelClassName,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDetailsElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Escape should land focus back on the trigger, not nowhere.
      ref.current?.querySelector<HTMLElement>("summary")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const summary = selected.length === 0 ? allLabel : summarize(selected, options);

  return (
    <details
      ref={ref}
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={cn("relative", disabled && "pointer-events-none opacity-50", className)}
    >
      <summary
        className={cn(
          "flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
          selected.length > 0 && "border-primary/40 bg-primary/5",
        )}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{summary}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn(
            "ml-auto size-3 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        >
          <path
            d="M2 4.5 6 8.5 10 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div
        className={cn(
          "absolute left-0 z-20 mt-1 flex max-h-72 min-w-full flex-col overflow-y-auto rounded-md border bg-background p-2 shadow-md",
          panelClassName,
        )}
      >
        {options.map((option) => (
          <CheckboxField
            key={option.value}
            label={option.label}
            hint={option.hint}
            checked={selected.includes(option.value)}
            disabled={option.disabled}
            onChange={() => toggle(option.value)}
            labelClassName="rounded-sm px-2 py-1.5 whitespace-nowrap hover:bg-accent/10"
          />
        ))}

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 border-t px-2 pt-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {clearLabel}
          </button>
        )}
      </div>
    </details>
  );
}

export { MultiSelect };
