import * as React from "react";
import { cn } from "@koolee/ui";

/**
 * The console's content column — admin's counterpart to `ContentColumn`.
 *
 * Why admin diverges from the shared frame, rather than adding a variant to
 * `packages/ui`:
 *
 *  - **Horizontal box.** `ContentColumn`'s `default` is `container`, which
 *    centres and caps at 1280px. That is the right frame for a page that
 *    shares its viewport with nothing; here the rail already takes 16rem off
 *    the left, so a second centring rule puts operational content in a narrow
 *    ribbon with dead space either side on any real ops monitor. The console
 *    caps at 1400px measured inside the frame, and dense boards drop the cap.
 *
 *  - **Vertical rhythm.** `py-10` is the consumer rhythm — generous, calm,
 *    correct for the booking funnel. An operator triaging a board trades that
 *    for two more rows above the fold, so the console runs `py-6`. The `gap-6`
 *    between blocks is unchanged, so cards still sit on the shared spacing
 *    scale and nothing about a Card or PageHeader is redefined here.
 *
 * `DESIGN.md`: a pattern is promoted into `packages/ui` when two or more apps
 * repeat it. Web and agent both still want the consumer rhythm, so this stays
 * in the app that needs it. Everything *inside* the column — Card, PageHeader,
 * Badge, EmptyState, the type scale — is still the shared system.
 */
const CONSOLE_WIDTHS = {
  /**
   * Card and form pages. Capped so a two-column form does not stretch to
   * 2000px on a wide desk monitor, where the eye loses the row it is on.
   */
  default: "mx-auto w-full max-w-[1400px]",
  /**
   * Dense operational tables — the dispatch board. Every column matters more
   * than the centred rhythm, so the cap comes off and only the gutters stay.
   */
  wide: "w-full",
  /** Small utility screens inside the console frame. */
  narrow: "mx-auto w-full max-w-2xl",
} as const;

export interface ConsoleMainProps extends React.HTMLAttributes<HTMLElement> {
  width?: keyof typeof CONSOLE_WIDTHS;
}

/** One per page — this is the page's `<main>`. */
export function ConsoleMain({
  width = "default",
  className,
  ...props
}: ConsoleMainProps) {
  return (
    <main
      className={cn(
        "flex flex-col gap-6 px-4 py-6 sm:px-6",
        CONSOLE_WIDTHS[width],
        className,
      )}
      {...props}
    />
  );
}
