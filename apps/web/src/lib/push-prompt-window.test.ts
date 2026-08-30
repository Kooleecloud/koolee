import { describe, expect, it } from "vitest";

import { PUSH_PROMPT_LEAD_HOURS, withinPushPromptWindow } from "./push-prompt-window";

/**
 * When the customer sees the notification prompt.
 *
 * Worth its own test because getting it wrong is not a visual bug: the
 * browser's permission prompt is ONE-SHOT. Showing this card the moment
 * somebody books — months early, about something not happening yet — is how
 * a denial gets collected that no later moment can undo.
 */

const NOW = new Date("2026-06-10T12:00:00Z");
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * 3_600_000);

describe("withinPushPromptWindow", () => {
  it("says nothing on a booking made months ahead", () => {
    expect(withinPushPromptWindow(at(24 * 60), at(24 * 60 + 1), NOW)).toBe(false);
  });

  it("says nothing the day before pickup day", () => {
    expect(withinPushPromptWindow(at(30), at(31), NOW)).toBe(false);
  });

  it("appears once the window is inside a day", () => {
    expect(withinPushPromptWindow(at(23), at(24), NOW)).toBe(true);
    expect(withinPushPromptWindow(at(2), at(3), NOW)).toBe(true);
  });

  it("includes the boundary", () => {
    expect(withinPushPromptWindow(at(PUSH_PROMPT_LEAD_HOURS), at(25), NOW)).toBe(true);
    // A minute past it is still too early.
    expect(
      withinPushPromptWindow(
        new Date(at(PUSH_PROMPT_LEAD_HOURS).getTime() + 60_000),
        at(25),
        NOW,
      ),
    ).toBe(false);
  });

  it("stays up through the window itself — that is when people watch", () => {
    expect(withinPushPromptWindow(at(-0.5), at(0.5), NOW)).toBe(true);
  });

  it("goes away once the window has closed", () => {
    // The agent has been and gone; the trip page's own live updates are the
    // better channel for whoever is still watching.
    expect(withinPushPromptWindow(at(-3), at(-2), NOW)).toBe(false);
  });

  it("falls back to the start when there is no end", () => {
    expect(withinPushPromptWindow(at(-0.5), null, NOW)).toBe(false);
    expect(withinPushPromptWindow(at(1), null, NOW)).toBe(true);
  });

  it("never shows on a booking with no window at all", () => {
    expect(withinPushPromptWindow(null, null, NOW)).toBe(false);
  });
});
