"use client";

import * as React from "react";

import { cn } from "../lib/utils";

const VARIANT_CLASSES = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-success/40 bg-success/10 text-navy-800",
  info: "border-sky-300 bg-sky-50 text-navy-800",
} as const;

export interface FormMessageProps {
  variant?: keyof typeof VARIANT_CLASSES;
  className?: string;
  children: React.ReactNode;
}

/**
 * The one shape for inline mutation feedback: boxed banner, correct live
 * region per variant (errors interrupt, successes announce politely), and it
 * scrolls itself into view on mount so feedback rendered below the fold —
 * e.g. under a long form — is never silently off-screen.
 */
function FormMessage({ variant = "error", className, children }: FormMessageProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div
      ref={ref}
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

export { FormMessage };
