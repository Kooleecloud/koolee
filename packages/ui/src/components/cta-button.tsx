import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { Spinner } from "./spinner";

/**
 * The primary call to action, styled as a luggage tag: rounded tab end with a
 * punched eyelet, in the exact orange of Koolee's physical tamper-evident
 * seal. The button a customer clicks online is the same orange as the tag
 * that protects their bag.
 *
 * Rules: `tag` orange is for CTAs only — never decoration. Text is navy for
 * WCAG AA contrast on the orange (white fails at 2.8:1; navy passes at 5.4:1).
 *
 * Interactions are pure CSS (lift on hover, settle on press) so this stays a
 * server component and never blocks paint on a JS bundle.
 */
const ctaButtonVariants = cva(
  [
    "group relative inline-flex select-none items-center justify-center gap-2",
    "whitespace-nowrap font-semibold transition-all duration-200 ease-out-expo",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        tag: [
          "rounded-l-full rounded-r-lg bg-tag text-navy-900 shadow-lift",
          "hover:-translate-y-0.5 hover:bg-tag-300 hover:shadow-lift-lg",
          "active:translate-y-0 active:scale-[0.98] active:shadow-lift",
          /* Punched eyelet — the tag's hole. */
          "before:absolute before:rounded-full before:border-2",
          "before:border-navy-900/35 before:content-['']",
        ].join(" "),
        /** Quiet secondary action, e.g. "How it works" next to the tag CTA. */
        ghost: [
          "rounded-lg border border-navy-200 bg-transparent text-navy-800",
          "hover:border-navy-300 hover:bg-navy-50",
          "active:scale-[0.98]",
        ].join(" "),
        /** For navy sections where ghost borders vanish. */
        "ghost-inverse": [
          "rounded-lg border border-white/25 bg-transparent text-white",
          "hover:border-white/40 hover:bg-white/10",
          "active:scale-[0.98]",
        ].join(" "),
      },
      size: {
        default: "h-11 px-6 text-sm before:left-3 before:size-2",
        lg: "h-12 px-7 text-base before:left-3.5 before:size-2.5",
        sm: "h-9 px-5 text-xs before:left-2.5 before:size-1.5",
      },
    },
    compoundVariants: [
      /* The eyelet needs breathing room on the tab end. */
      { variant: "tag", size: "default", className: "pl-8" },
      { variant: "tag", size: "lg", className: "pl-9" },
      { variant: "tag", size: "sm", className: "pl-6" },
    ],
    defaultVariants: { variant: "tag", size: "default" },
  },
);

export interface CTAButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof ctaButtonVariants> {
  /** Render the child element (e.g. a Next.js Link) with tag styling. */
  asChild?: boolean;
  /** Pending state — see Button. Ignored with `asChild`. */
  loading?: boolean;
}

const CTAButton = React.forwardRef<HTMLButtonElement, CTAButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(ctaButtonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || (loading && !asChild) || undefined}
        aria-busy={loading && !asChild ? true : undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Spinner /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
CTAButton.displayName = "CTAButton";

export { CTAButton, ctaButtonVariants };
