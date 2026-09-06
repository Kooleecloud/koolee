"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "../lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Tailwind-styled react-day-picker. No base stylesheet is imported — every
 * class comes from the theme tokens, so light/dark and the brand palette apply
 * without overriding a third-party CSS API.
 *
 * State classes hang off the day CELL and reach the button with `[&>button]`,
 * which is stable regardless of whether react-day-picker puts `aria-selected`
 * on the cell or the button.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit", className)}
      classNames={{
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-3",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "inline-flex size-8 items-center justify-center rounded-md text-navy-800 " +
          "transition-colors hover:bg-accent/15 disabled:pointer-events-none disabled:opacity-40 " +
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        button_next:
          "inline-flex size-8 items-center justify-center rounded-md text-navy-800 " +
          "transition-colors hover:bg-accent/15 disabled:pointer-events-none disabled:opacity-40 " +
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-medium text-navy-800",
        month_grid: "w-full border-collapse",
        weekday:
          "size-9 pb-1 text-center text-[0.75rem] font-normal text-muted-foreground",
        day: "p-0 text-center align-middle",
        day_button:
          "inline-flex size-9 items-center justify-center rounded-md text-sm font-normal " +
          "transition-colors hover:bg-accent/15 focus-visible:outline-hidden " +
          "focus-visible:ring-2 focus-visible:ring-ring",
        selected:
          "[&>button]:bg-sky-700 [&>button]:font-medium [&>button]:text-white " +
          "[&>button]:hover:bg-sky-700",
        today: "[&>button]:ring-1 [&>button]:ring-sky-400",
        outside: "[&>button]:text-muted-foreground/50",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon aria-hidden className={cn("size-4", chevronClassName)} />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
