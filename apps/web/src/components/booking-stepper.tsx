"use client";

import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@koolee/ui";

const STEPS = [
  { href: "/book/zip", label: "ZIP", also: [] as string[] },
  { href: "/book/flight", label: "Flight", also: [] as string[] },
  { href: "/book/address", label: "Address", also: [] as string[] },
  { href: "/book/bags", label: "Bags", also: [] as string[] },
  { href: "/book/slot", label: "Pickup", also: [] as string[] },
  { href: "/book/price", label: "Price", also: [] as string[] },
  // The verification gate lives between price and payment; highlight "Pay".
  { href: "/book/pay", label: "Pay", also: ["/book/verify"] },
] as const;

/** Progress indicator for the booking flow — knows the current step from the URL. */
export function BookingStepper() {
  const pathname = usePathname();
  const currentIndex = STEPS.findIndex(
    (step) =>
      pathname.startsWith(step.href) ||
      step.also.some((alias) => pathname.startsWith(alias)),
  );

  return (
    <nav aria-label="Booking progress" className="border-b bg-white">
      <ol className="container flex max-w-3xl items-center gap-1 overflow-x-auto py-3">
        {STEPS.map((step, i) => {
          const state =
            currentIndex === -1
              ? "upcoming"
              : i < currentIndex
                ? "complete"
                : i === currentIndex
                  ? "current"
                  : "upcoming";
          return (
            <li key={step.href} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-1 h-px w-4 sm:w-6",
                    state === "upcoming" ? "bg-border" : "bg-sky-400",
                  )}
                />
              )}
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  state === "complete" && "text-sky-700",
                  state === "current" && "bg-navy-800 text-white",
                  state === "upcoming" && "text-muted-foreground",
                )}
              >
                {state === "complete" ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <span aria-hidden="true">{i + 1}.</span>
                )}
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
