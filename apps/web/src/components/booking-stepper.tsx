"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@koolee/ui";

import { startOverBooking } from "@/app/book/actions";
import { ConfirmActionForm } from "@/components/confirm-action-form";
import { BOOKING_STEPS } from "@/lib/booking-steps";

/**
 * Progressive stepper for the booking flow.
 *
 * `completed` comes from the server (the draft cookie); the current step
 * comes from the URL. Completed steps are links — jump back, edit, and the
 * submit lands you back at the frontier. Locked steps stay unnamed ("···")
 * and unclickable until every step before them is complete. Once there is
 * progress, a "Start over" escape discards the draft entirely.
 */
export function BookingStepper({ completed }: { completed: boolean[] }) {
  const pathname = usePathname();
  const currentIndex = BOOKING_STEPS.findIndex(
    (step) =>
      pathname.startsWith(step.href) ||
      step.also.some((alias) => pathname.startsWith(alias)),
  );

  // Off-funnel pages (/book/confirmed, /book/processing): the flow is over.
  if (currentIndex === -1) return null;

  return (
    <nav
      aria-label="Booking progress"
      className="border-b bg-white"
    >
      <div className="container flex max-w-3xl items-center justify-between gap-3">
        <ol className="flex items-center gap-1 overflow-x-auto py-3">
        {BOOKING_STEPS.map((step, i) => {
          const unlocked = completed.slice(0, i).every(Boolean);
          const state =
            i === currentIndex
              ? "current"
              : completed[i]
                ? "complete"
                : unlocked
                  ? "open"
                  : "locked";

          const chip = (
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                state === "complete" && "text-sky-700 hover:bg-sky-50",
                state === "current" && "bg-navy-800 text-white",
                state === "open" && "text-muted-foreground hover:bg-accent/10",
                state === "locked" && "text-muted-foreground/50",
              )}
            >
              {state === "complete" ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <span aria-hidden="true">{i + 1}.</span>
              )}
              {state === "locked" ? (
                <span aria-hidden="true">···</span>
              ) : (
                step.label
              )}
              {state === "locked" && (
                <span className="sr-only">Step locked — finish the previous steps</span>
              )}
            </span>
          );

          return (
            <li key={step.href} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-1 h-px w-4 sm:w-6",
                    unlocked ? "bg-sky-400" : "bg-border",
                  )}
                />
              )}
              {state === "complete" || state === "open" ? (
                <Link href={step.href}>{chip}</Link>
              ) : (
                chip
              )}
            </li>
          );
        })}
        </ol>

        {completed.some(Boolean) && (
          <ConfirmActionForm
            action={startOverBooking}
            message="Start over? This clears your booking so far."
          >
            <button
              type="submit"
              className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Start over
            </button>
          </ConfirmActionForm>
        )}
      </div>
    </nav>
  );
}
