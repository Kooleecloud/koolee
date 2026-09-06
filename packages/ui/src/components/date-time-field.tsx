"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { cn } from "../lib/utils";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Date + time field whose submitted value is a WALL-CLOCK string
 * (`YYYY-MM-DDTHH:mm`) — byte-identical to what `<input type="datetime-local">`
 * posts, so every downstream reader is unaffected.
 *
 * That contract is load-bearing. The flight step feeds this the AIRPORT's wall
 * clock, not the browser's, so the value must never be reinterpreted against a
 * timezone. Accordingly every transformation below is string- and
 * integer-level. The single `Date` this builds exists only so react-day-picker
 * has something to render, and it is constructed from — and read back as —
 * LOCAL calendar fields, so the y/m/d that goes in is the y/m/d that comes
 * out. No instants, no UTC, no offset math.
 *
 * WHY IT IS SEGMENTS AND NOT A BUTTON.
 *
 * The previous version was a single trigger that opened a calendar, with an
 * `<input type="time">` underneath. To move a departure from March to April
 * you paged the calendar; to fix a year you paged it twelve times. There was
 * no way to change ONE part of the date — which is the entire interaction
 * somebody performs when a form has guessed wrong, and it is the reason this
 * read as an old control.
 *
 * So the date is six editable segments — MM / DD / YYYY and hh : mm plus a
 * meridiem toggle — each one directly typable, each one arrow-key
 * incrementable, auto-advancing when it fills. The calendar survives as a
 * popover for people who want to pick a day by looking at a month, which is a
 * different task from correcting one field.
 *
 * Past dates are deliberately NOT disabled: "today" in the browser can differ
 * from "today" at the airport, and blocking a locally-past-but-airport-valid
 * date would be a real bug. The server owns that rule and already reports it.
 */

/* ------------------------------------------------------------------ */
/* The value, as parts                                                 */
/* ------------------------------------------------------------------ */

interface Parts {
  /** Every segment is a STRING, including partial input ("" and "0" are real). */
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  meridiem: "AM" | "PM";
}

const EMPTY: Parts = {
  month: "",
  day: "",
  year: "",
  hour: "",
  minute: "",
  meridiem: "AM",
};

/** `YYYY-MM-DDTHH:mm` → parts. Anything unparseable yields empty segments. */
function toParts(value: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return EMPTY;
  const hour24 = Number(match[4]);
  return {
    year: match[1]!,
    month: match[2]!,
    day: match[3]!,
    hour: String(hour24 % 12 === 0 ? 12 : hour24 % 12).padStart(2, "0"),
    minute: match[5]!,
    meridiem: hour24 < 12 ? "AM" : "PM",
  };
}

/**
 * Parts → `YYYY-MM-DDTHH:mm`, or "" while anything is missing or out of range.
 *
 * Empty is a legitimate in-progress state, not an error: somebody halfway
 * through typing a year has no value yet, and inventing one would post a
 * departure they never chose. The server already rejects an empty submission
 * with a sentence.
 */
function toValue(parts: Parts): string {
  const month = Number(parts.month);
  const day = Number(parts.day);
  const year = Number(parts.year);
  const hour12 = Number(parts.hour);
  const minute = Number(parts.minute);

  if (!parts.month || !parts.day || parts.year.length !== 4) return "";
  if (!parts.hour || !parts.minute) return "";
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > daysInMonth(month, year)) return "";
  if (hour12 < 1 || hour12 > 12) return "";
  if (minute < 0 || minute > 59) return "";

  // 12 AM is 00, 12 PM is 12 — the two cases every hand-rolled converter gets
  // wrong, and the reason this is one function rather than inline arithmetic.
  const hour24 =
    parts.meridiem === "AM"
      ? hour12 === 12
        ? 0
        : hour12
      : hour12 === 12
        ? 12
        : hour12 + 12;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour24)}:${pad(minute)}`;
}

/** Real calendar lengths, leap years included — a Feb 30 must not submit. */
function daysInMonth(month: number, year: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A LOCAL Date carrying the wall clock's calendar fields — never an instant. */
function toCalendarDate(parts: Parts): Date | undefined {
  const month = Number(parts.month);
  const day = Number(parts.day);
  const year = Number(parts.year);
  if (!month || !day || parts.year.length !== 4) return undefined;
  return new Date(year, month - 1, day);
}

/* ------------------------------------------------------------------ */
/* One segment                                                         */
/* ------------------------------------------------------------------ */

interface SegmentSpec {
  key: keyof Omit<Parts, "meridiem">;
  label: string;
  placeholder: string;
  length: number;
  min: number;
  max: number;
  /** Characters typed before focus moves on. Year never auto-advances. */
  advanceAt: number | null;
}

function Segment({
  spec,
  value,
  onChange,
  onAdvance,
  disabled,
  invalid,
}: {
  spec: SegmentSpec;
  value: string;
  onChange: (next: string) => void;
  onAdvance: () => void;
  disabled?: boolean;
  invalid: boolean;
}) {
  /**
   * Arrow keys step the value and WRAP, the way every native date segment
   * does. Wrapping matters more than it sounds: correcting a month from
   * January to December is one keystroke down, not eleven up.
   */
  function step(delta: number) {
    const current = value === "" ? spec.min - delta : Number(value);
    const span = spec.max - spec.min + 1;
    const next = ((((current + delta - spec.min) % span) + span) % span) + spec.min;
    onChange(String(next).padStart(spec.length === 4 ? 4 : 2, "0"));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={spec.label}
      aria-invalid={invalid || undefined}
      placeholder={spec.placeholder}
      value={value}
      disabled={disabled}
      maxLength={spec.length}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, spec.length);
        onChange(digits);
        // Auto-advance only on a full segment, and never out of the year:
        // typing "1" for January must not jump away before "12" is possible.
        if (spec.advanceAt !== null && digits.length >= spec.advanceAt) onAdvance();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          step(1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          step(-1);
        }
      }}
      onFocus={(event) => event.target.select()}
      onBlur={(event) => {
        /*
         * Pad on the way out, so "3" reads back as "03" and the row stays
         * aligned. On blur rather than on change, so typing "3" then "0" for
         * the 30th still works.
         *
         * READ THE DOM, NOT THE PROP. `value` is this render's prop, and blur
         * arrives in the SAME event turn as the auto-advance that caused it —
         * before React has re-rendered with the character just typed. Closing
         * over `value` therefore saw the PREVIOUS keystroke: typing "11" for
         * November left the DOM correctly at "11", then this handler padded
         * the stale "1" to "01" and wrote it back. Every two-digit segment was
         * silently losing its second digit, for everybody, on every entry.
         *
         * `event.target.value` is what is actually in the field. Found by
         * typing into a real browser; typecheck, lint and 116 unit tests were
         * all green over it, because the pure conversion this component wraps
         * was never wrong.
         */
        const raw = event.target.value;
        if (spec.length === 2 && raw.length === 1) {
          onChange(raw.padStart(2, "0"));
        }
      }}
      className={cn(
        "bg-transparent text-center tabular-nums outline-hidden",
        "text-navy-800 placeholder:text-muted-foreground/70",
        "focus:rounded-sm focus:bg-sky-100/70",
        spec.length === 4 ? "w-[4ch]" : "w-[2.2ch]",
        invalid && "text-destructive",
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* The field                                                           */
/* ------------------------------------------------------------------ */

const DATE_SEGMENTS: SegmentSpec[] = [
  {
    key: "month",
    label: "Month",
    placeholder: "MM",
    length: 2,
    min: 1,
    max: 12,
    advanceAt: 2,
  },
  {
    key: "day",
    label: "Day",
    placeholder: "DD",
    length: 2,
    min: 1,
    max: 31,
    advanceAt: 2,
  },
  {
    key: "year",
    label: "Year",
    placeholder: "YYYY",
    length: 4,
    min: 1970,
    max: 2100,
    advanceAt: null,
  },
];

const TIME_SEGMENTS: SegmentSpec[] = [
  {
    key: "hour",
    label: "Hour",
    placeholder: "hh",
    length: 2,
    min: 1,
    max: 12,
    advanceAt: 2,
  },
  {
    key: "minute",
    label: "Minute",
    placeholder: "mm",
    length: 2,
    min: 0,
    max: 59,
    advanceAt: 2,
  },
];

export interface DateTimeFieldProps {
  /** Form field name. The posted value is a `datetime-local` wall-clock string. */
  name: string;
  id?: string;
  defaultValue?: string;
  /** Shown under the control — e.g. "Times are JFK local". */
  hint?: string;
  className?: string;
  /** Applied to the control shell — e.g. the extracted-field attention ring. */
  triggerClassName?: string;
  disabled?: boolean;
}

function DateTimeField({
  name,
  id,
  defaultValue = "",
  hint,
  className,
  triggerClassName,
  disabled,
}: DateTimeFieldProps) {
  const [parts, setParts] = React.useState<Parts>(() => toParts(defaultValue));
  const [open, setOpen] = React.useState(false);

  /**
   * Focus order for auto-advance. Refs rather than a query, because the
   * segments render in two groups either side of a separator and DOM order is
   * the only thing that makes "next" meaningful.
   */
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = (index: number) => refs.current[index + 1]?.focus();

  const value = toValue(parts);
  const selected = toCalendarDate(parts);
  /**
   * Only ever "you typed something that cannot be a date", never "you have not
   * finished". A half-typed year is not an error and must not go red.
   */
  const filled =
    parts.month !== "" &&
    parts.day !== "" &&
    parts.year.length === 4 &&
    parts.hour !== "" &&
    parts.minute !== "";
  const invalid = filled && value === "";

  const set = (key: keyof Parts) => (next: string) =>
    setParts((current) => ({ ...current, [key]: next }));

  const segment = (spec: SegmentSpec, index: number) => (
    <Segment
      key={spec.key}
      spec={spec}
      value={parts[spec.key]}
      onChange={set(spec.key)}
      onAdvance={() => focusNext(index)}
      disabled={disabled}
      invalid={invalid}
    />
  );

  return (
    <div className={cn("grid gap-1.5", className)}>
      {/* The one thing that leaves this component. Everything above is a way
          of editing it. */}
      <input type="hidden" name={name} value={value} readOnly />

      <div
        id={id}
        className={cn(
          "flex h-11 w-full items-center gap-1 rounded-md border border-input",
          "bg-background px-3 text-sm transition-colors",
          "focus-within:ring-2 focus-within:ring-ring",
          !disabled && "hover:border-sky-400",
          disabled && "opacity-50",
          invalid && "border-destructive",
          triggerClassName,
        )}
      >
        <span
          className="flex items-center"
          // The group reads as one control; the segments carry their own names.
          role="group"
          aria-label="Date"
        >
          {DATE_SEGMENTS.map((spec, index) => (
            <React.Fragment key={spec.key}>
              {index > 0 && <Separator>/</Separator>}
              <span ref={(node) => registerAt(refs, index, node)}>
                {segment(spec, index)}
              </span>
            </React.Fragment>
          ))}
        </span>

        <span aria-hidden className="px-1 text-muted-foreground/50">
          |
        </span>

        <span className="flex items-center" role="group" aria-label="Time">
          {TIME_SEGMENTS.map((spec, index) => (
            <React.Fragment key={spec.key}>
              {index > 0 && <Separator>:</Separator>}
              <span ref={(node) => registerAt(refs, DATE_SEGMENTS.length + index, node)}>
                {segment(spec, DATE_SEGMENTS.length + index)}
              </span>
            </React.Fragment>
          ))}
          {/*
            A two-state toggle, not a select. AM/PM has exactly two values and
            a dropdown for two values is a menu somebody has to open, read and
            close — where this is one tap or one space bar.
          */}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Meridiem, currently ${parts.meridiem}`}
            onClick={() =>
              setParts((current) => ({
                ...current,
                meridiem: current.meridiem === "AM" ? "PM" : "AM",
              }))
            }
            className={cn(
              "ml-1.5 rounded-sm px-1.5 py-0.5 text-xs font-semibold text-navy-700",
              "transition-colors hover:bg-accent/15",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none",
            )}
          >
            {parts.meridiem}
          </button>
        </span>

        {/* The calendar is now the SECOND way in, for picking a day by looking
            at a month. Correcting one field no longer needs it. */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className={cn(
              "ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md",
              "text-sky-700 transition-colors hover:bg-accent/15",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none",
            )}
          >
            <CalendarDays aria-hidden className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              autoFocus
              onSelect={(day) => {
                if (!day) return;
                // Read back as LOCAL fields — never `toISOString`, which would
                // shift the chosen day by the browser's offset.
                setParts((current) => ({
                  ...current,
                  year: String(day.getFullYear()),
                  month: String(day.getMonth() + 1).padStart(2, "0"),
                  day: String(day.getDate()).padStart(2, "0"),
                  // Picking a day should not leave a blank time behind: an
                  // unset time makes the whole value empty, and the customer
                  // has no way to see why their submission was refused.
                  hour: current.hour || "12",
                  minute: current.minute || "00",
                }));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {invalid ? (
        <p className="text-xs text-destructive">
          That date does not exist — check the day and month.
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Separator({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="text-muted-foreground/70">
      {children}
    </span>
  );
}

/**
 * Records the segment input inside a wrapper span, so auto-advance can focus
 * the next one. The wrapper exists because `Segment` renders a bare `<input>`
 * and forwarding a ref through it would add a prop that only this file needs.
 */
function registerAt(
  refs: React.RefObject<(HTMLInputElement | null)[]>,
  index: number,
  node: HTMLSpanElement | null,
): void {
  refs.current[index] = node?.querySelector("input") ?? null;
}

export { DateTimeField };

/**
 * Exported for the tests only. The 12 AM / 12 PM conversion and the leap-year
 * length are the two things here that are easy to get wrong and impossible to
 * see wrong in a browser without deliberately going looking, so they are
 * pinned by assertions rather than by inspection.
 */
export const __dateTimeFieldInternals = { toParts, toValue, daysInMonth };
