import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Marketing layout primitives. Pages compose these; the primitives own
 * rhythm (vertical spacing, container width) so every page breathes the same.
 */

const sectionVariants = cva("relative", {
  variants: {
    tone: {
      /** Warm off-white page background shows through. */
      default: "",
      /** White band — lifts cards and widgets off the page. */
      raised: "bg-white",
      /** Navy band — closing CTAs, footer-adjacent sections. */
      navy: "bg-navy-800 text-white",
    },
    space: {
      default: "py-16 sm:py-24",
      compact: "py-10 sm:py-14",
      none: "",
    },
  },
  defaultVariants: { tone: "default", space: "default" },
});

export interface SectionProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {}

const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ className, tone, space, children, ...props }, ref) => (
    <section ref={ref} className={cn(sectionVariants({ tone, space }), className)} {...props}>
      <div className="container">{children}</div>
    </section>
  ),
);
Section.displayName = "Section";

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small overline label, e.g. "How it works". */
  eyebrow?: React.ReactNode;
  heading: React.ReactNode;
  /** Supporting sentence under the heading. */
  body?: React.ReactNode;
  align?: "left" | "center";
  /** Heading level for document outline. Defaults to h2. */
  as?: "h1" | "h2" | "h3";
}

function SectionHeader({
  eyebrow,
  heading,
  body,
  align = "left",
  as: Heading = "h2",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-3",
        align === "center" && "mx-auto items-center text-center",
        className,
      )}
      {...props}
    >
      {eyebrow ? (
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
          {eyebrow}
        </p>
      ) : null}
      <Heading className="font-display text-display font-semibold text-navy-800">
        {heading}
      </Heading>
      {body ? <p className="text-lg leading-relaxed text-muted-foreground">{body}</p> : null}
    </div>
  );
}

export { Section, SectionHeader, sectionVariants };
