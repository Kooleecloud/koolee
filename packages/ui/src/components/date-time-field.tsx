"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { cn } from "../lib/utils";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Date + time field whose submitted value is a WALL-CLOCK string
 * (`YYYY-MM-DDTHH:mm`) — byte-identical to what `<input type="datetime-local">`
 * posts, so every downstream reader is unaffected.
 *
 * That contract is load-bearing. The flight step feeds this the AIRPORT's wall
 * clock, not the browser's, so the value must never be reinterpreted against a
 * timezone. Accordingly every transformation below is string-level. The single
 * `Date` we build exists only so react-day-picker has something to render, and
 * it is constructed from — and read back as — LOCAL calendar fields, so the
 * y/m/d that goes in is the y/m/d that comes out. No instants, no UTC, no
 * offset math.
 *
 * Past dates are deliberately NOT disabled: "today" in the browser can differ
 * from "today" at the airport, and blocking a locally-past-but-airport-valid
 * date would be a real bug. The server owns that rule and already reports it.
 */

function splitValue(value: string): { date: string; time: string } {
  const [date = "", rest = ""] = value.split("T");
  return { date, time: rest.slice(0, 5) };
}

/** A LOCAL Date carrying the wall clock's calendar fields — never an instant. */
function toCalendarDate(date: string): Date | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return undefined;
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** Inverse of {@link toCalendarDate} — reads LOCAL fields, never `toISOString`. */
function fromCalendarDate(day: Date): string {
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Formatted from LOCAL fields of the synthetic date built above — never from an
 * instant, so there is no timezone to get wrong. Deliberately not
 * `Intl.DateTimeFormat`: the repo bans it here (docs/TIME.md), and a fixed
 * table also keeps the label identical for every viewer.
 */
function formatDateLabel(day: Date): string {
  return `${WEEKDAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`;
}

function formatTime(time: string): string {
  const parts = /^(\d{2}):(\d{2})$/.exec(time);
  if (!parts) return "";
  const hour24 = Number(parts[1]);
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${parts[2]} ${suffix}`;
}

export interface DateTimeFieldProps {
  /** Form field name. The posted value is a `datetime-local` wall-clock string. */
  name: string;
  id?: string;
  defaultValue?: string;
  /** Shown under the control — e.g. "Times are JFK local". */
  hint?: string;
  className?: string;
  /** Applied to the trigger itself — e.g. the extracted-field attention ring. */
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
  const [value, setValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const { date, time } = splitValue(value);

  const commit = (nextDate: string, nextTime: string) => {
    // Time defaults so picking only a date still yields a usable value; an
    // empty date keeps the whole field empty, which the server rejects with a
    // readable message rather than us inventing a day.
    if (!nextDate) {
      setValue("");
      return;
    }
    setValue(`${nextDate}T${nextTime || "00:00"}`);
  };

  const selected = toCalendarDate(date);
  const label =
    selected && time
      ? `${formatDateLabel(selected)} · ${formatTime(time)}`
      : selected
        ? formatDateLabel(selected)
        : "Pick date and time";

  return (
    <div className={cn("grid gap-1.5", className)}>
      <input type="hidden" name={name} value={value} readOnly />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-md border",
            "border-input bg-background px-3 text-left text-sm text-navy-800",
            "transition-colors hover:border-sky-400 focus-visible:outline-hidden",
            "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            !selected && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span>{label}</span>
          <CalendarDays aria-hidden className="size-4 shrink-0 text-sky-700" />
        </PopoverTrigger>
        <PopoverContent className="flex flex-col gap-3">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            autoFocus
            onSelect={(day) => {
              if (!day) return;
              commit(fromCalendarDate(day), time);
            }}
          />
          <div className="grid gap-1.5 border-t border-border pt-3">
            <label
              htmlFor={`${name}-time`}
              className="text-xs font-medium text-muted-foreground"
            >
              Time
            </label>
            <Input
              id={`${name}-time`}
              type="time"
              value={time}
              onChange={(event) => commit(date, event.target.value)}
              className="h-10"
            />
          </div>
        </PopoverContent>
      </Popover>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export { DateTimeField };
