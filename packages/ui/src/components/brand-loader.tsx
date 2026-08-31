import { cn } from "../lib/utils";

/**
 * The Koolee waiting animation, and the full-screen version of it.
 *
 * WHY THE BRAND MARK AND NOT A SPINNER. A spinner says "something is
 * happening"; on the two screens where Koolee makes somebody wait — authorizing
 * a card, and the moments after — what they need to be told is "your bags are
 * in hand and nothing has gone wrong". The mark is a tamper-evident luggage
 * tag, so the animation is the one thing a tag on a handle actually does: it
 * swings. Under it, the seal ring turns.
 *
 * The two motions run on different periods (1.6s and 2.4s) so they never sync
 * into a single beat, which is what makes a loop look like a loop.
 *
 * MOTION IS OPTIONAL AND THE MEANING IS NOT. `motion-reduce` stops both
 * animations; the mark, the ring and the words are all still there, so
 * somebody who has asked their system for less motion sees a static badge and
 * a sentence rather than nothing at all.
 */

const SKY = "#38B6E3";
const ORANGE = "#FF6B35";

export interface BrandLoaderProps {
  /** `sm` inline beside text, `md` in a card, `lg` in the overlay. */
  size?: "sm" | "md" | "lg";
  className?: string;
  /**
   * What is being waited for, for a screen reader. Rendered visually only by
   * `BrandLoadingOverlay`, which has room for it.
   */
  label?: string;
}

const SIZES = {
  sm: { box: "size-8", stroke: 2 },
  md: { box: "size-14", stroke: 2.5 },
  lg: { box: "size-24", stroke: 3 },
} as const;

export function BrandLoader({ size = "md", className, label }: BrandLoaderProps) {
  const { box, stroke } = SIZES[size];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("relative inline-flex items-center justify-center", box, className)}
    >
      {/* The seal ring, turning. A dashed circle rather than a solid arc: the
          seal is a serialized band, and a dashed stroke is what reads as one
          at 24px. */}
      <svg
        viewBox="0 0 48 48"
        aria-hidden="true"
        className="absolute inset-0 size-full animate-seal-turn motion-reduce:animate-none"
      >
        <circle
          cx="24"
          cy="24"
          r="21"
          fill="none"
          stroke={SKY}
          strokeOpacity="0.45"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray="10 16"
        />
      </svg>

      {/*
        The tag, swinging about its own grommet.
        `transform-origin` is the eyelet at (13, 12.5) in the mark's own
        viewBox — 27% across, 26% down — so it pivots where a real tag hangs
        rather than about the middle of a box.
      */}
      <svg
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
        className="size-[62%] origin-[27%_26%] animate-tag-swing text-primary motion-reduce:animate-none"
      >
        <path d="M16 27.5 38.5 8.5" stroke={SKY} strokeWidth="8.5" strokeLinecap="round" />
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M11.5 5h3a6.5 6.5 0 0 1 6.5 6.5v29a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 5 40.5v-29A6.5 6.5 0 0 1 11.5 5Zm1.5 4.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z"
        />
        <path d="M16 27.5 37.5 41.5" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" />
        {/* The grommet, breathing. Tag orange, which the brand system reserves
            for CTAs and the seal — this is the seal. */}
        <circle
          cx="13"
          cy="12.5"
          r="3.75"
          stroke={ORANGE}
          strokeWidth="2.1"
          className="animate-seal-pulse motion-reduce:animate-none"
          style={{ transformOrigin: "13px 12.5px" }}
        />
      </svg>

      <span className="sr-only">{label ?? "Working…"}</span>
    </span>
  );
}

export interface BrandLoadingOverlayProps {
  /** Nothing renders while false, so a caller can mount this unconditionally. */
  open: boolean;
  /** One line, present tense: "Authorizing your payment…". */
  title: string;
  /** The reassuring half. Say what is and is not happening to their money. */
  description?: string;
  className?: string;
}

/**
 * A full-screen scrim that makes the page genuinely unusable while something
 * irreversible is in flight.
 *
 * THE BUG THIS FIXES. Authorizing a card disabled the submit button and
 * nothing else. Every other control on the review page stayed live: Edit links
 * back into the funnel, the promo field, the browser's own back button one
 * gesture away — all of them reachable while Stripe was mid-confirm. A button
 * spinner is a statement about the button; what was needed was a statement
 * about the page.
 *
 * WHY `fixed inset-0` AND NOT A DIALOG. There is nothing to focus and nothing
 * to dismiss — a Radix dialog would add a close affordance to a moment that
 * must not be closable, and would move focus somewhere the customer did not
 * ask to go. This covers the viewport, swallows pointer events, and hides
 * itself from assistive tech except for the live region inside `BrandLoader`,
 * which is the one thing worth announcing.
 */
export function BrandLoadingOverlay({
  open,
  title,
  description,
  className,
}: BrandLoadingOverlayProps) {
  if (!open) return null;

  return (
    <div
      // Every pointer event lands here and goes nowhere. Keyboard focus can
      // still move (we do not trap it, because trapping focus in a thing with
      // no controls is its own trap), but nothing behind this can be clicked.
      className={cn(
        "fixed inset-0 z-100 flex flex-col items-center justify-center gap-5",
        "bg-background/85 backdrop-blur-sm",
        "animate-in fade-in-0 duration-200",
        className,
      )}
    >
      <BrandLoader size="lg" label={title} />
      <div className="flex max-w-sm flex-col items-center gap-1.5 px-6 text-center">
        <p className="font-display text-lg font-semibold text-navy-800">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
