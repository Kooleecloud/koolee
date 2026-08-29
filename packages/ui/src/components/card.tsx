import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * The house surface. Every raised block in every app is one of these.
 *
 * The variants exist because each of them was, until 2026-08-29, hand-copied
 * into pages instead: admin and agent list rows carried their own
 * `rounded-xl border bg-white … shadow-xs`, and the hover-lift recipe was
 * transcribed (differently) in three places. Hand-rolled copies drifted in
 * two ways that matter — `bg-white` is invisible in the dark theme, and a
 * second elevation scale is how two cards on one page end up sitting at
 * different heights.
 */
const cardVariants = cva("border bg-card text-card-foreground", {
  variants: {
    /**
     * `default` is the in-app surface. `panel` is the larger marketing
     * block — same elevation, softer corner, used at section scale.
     */
    surface: {
      default: "rounded-xl shadow-lift",
      panel: "rounded-2xl shadow-lift",
    },
    /**
     * For a card that is itself a link or a picker option: lifts on hover,
     * shows the brand focus ring, and holds still for reduced-motion users.
     * Pair with `asChild` so the anchor keeps its own semantics.
     */
    interactive: {
      true: "transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lift-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      false: "",
    },
  },
  defaultVariants: {
    surface: "default",
    interactive: false,
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /** Render as the single child instead of a `div` — for `<li>`, `<Link>`, `<label>`. */
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, surface, interactive, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        className={cn(cardVariants({ surface, interactive }), className)}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  cardVariants,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
