/**
 * When the customer's "get live pickup updates" card is worth showing.
 *
 * Decided on the SERVER, not in the browser, for the same reason
 * `withinCutoffHorizon` is: if the two disagree about whether a card exists,
 * the page hydrates into a different shape than it rendered. It also means
 * the rule is one exported function with a test rather than a condition
 * buried in JSX.
 *
 * THE RULE: within 24 hours of the pickup window opening, and not after the
 * window has closed. Before that, a notification prompt is an interruption
 * about something that is not happening yet — the customer just booked, the
 * confirmation email has everything they need, and spending their one-shot
 * permission prompt on that moment is how it gets denied forever. Inside a
 * day, "we'll tell you when your driver is outside" is an offer.
 *
 * A booking with no window never qualifies: there is no day to be close to.
 */

const HOUR = 3_600_000;

/** How close to the window opening the prompt appears. */
export const PUSH_PROMPT_LEAD_HOURS = 24;

/**
 * Grace after the window opens during which the prompt still makes sense —
 * the visit itself, when a customer most wants to know where their bags are.
 * Ends at the window's close: after that the agent has been and gone.
 */
export function withinPushPromptWindow(
  windowStart: Date | null,
  windowEnd: Date | null,
  now: Date,
): boolean {
  if (!windowStart) return false;

  const opensIn = windowStart.getTime() - now.getTime();
  if (opensIn > PUSH_PROMPT_LEAD_HOURS * HOUR) return false;

  // Past the end of the window the pickup is under way or done, and the trip
  // page's own live updates are the better channel for whoever is watching.
  const closesAt = (windowEnd ?? windowStart).getTime();
  return now.getTime() <= closesAt;
}
