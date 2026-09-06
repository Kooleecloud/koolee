import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookingNotActionableError,
  ConflictError,
  InvalidInputError,
  NotAuthorizedError,
  NotFoundError,
} from "@koolee/core";

import { actionErrorMessage } from "./action-error";

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * A driver opened a cancelled pickup, tapped "I'm on my way", and read:
 *
 *     Couldn't start pickup. Check your connection and retry.
 *
 * Their connection was fine. `startPickupTravel` had refused through
 * `assertActionable`, which throws `BookingNotActionableError` carrying the
 * sentence "This booking was cancelled." — and the action's error handler
 * matched `NotFoundError` and `ConflictError` only, so the one message that
 * would have ended the confusion fell through to the connection fallback.
 *
 * Telling somebody their phone is broken when the answer is "this job does
 * not exist any more" is worse than saying nothing: it is an instruction to
 * keep trying, and trying harder is exactly the wrong thing to do.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("actionErrorMessage", () => {
  /*
   * THE CASE THAT BROKE. Named for the exact string the driver saw, so a
   * future change that reintroduces a subclass list fails here by name.
   */
  it('does not answer a cancelled booking with "check your connection"', () => {
    const refusal = new BookingNotActionableError(
      "startPickup",
      "terminal",
      "before_window_end",
      "This booking was cancelled.",
    );

    const message = actionErrorMessage(refusal, "Couldn't start pickup.", "[visit]");

    expect(message).toBe("This booking was cancelled.");
    expect(message).not.toContain("connection");
  });

  it.each([
    ["a booking that vanished", new NotFoundError("Booking", "abc")],
    ["a seal already recorded", new ConflictError("seal")],
    ["a truck already out", new ConflictError("shift")],
    ["a refused input", new InvalidInputError("sealId")],
    ["a permission refusal", new NotAuthorizedError()],
  ])("shows the domain's own message for %s", (_label, error) => {
    expect(actionErrorMessage(error, "Couldn't do that.", "[visit]")).toBe(error.message);
  });

  /*
   * A refusal is the system working. Logging it as an error fills the console
   * with correct behaviour, which is how the genuinely broken line stops being
   * noticed.
   */
  it("does not log a refusal", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    actionErrorMessage(new ConflictError("seal"), "Couldn't do that.", "[visit]");
    expect(spy).not.toHaveBeenCalled();
  });

  /* --- the other half: a real transport failure still says so ---------- */

  it.each([
    ["a dropped fetch", new TypeError("Failed to fetch")],
    ["an unexpected crash", new Error("boom")],
    ["a thrown string", "boom"],
    ["a thrown nothing", undefined],
  ])("falls back to the connection message for %s", (_label, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(actionErrorMessage(error, "Couldn't start pickup.", "[visit]")).toBe(
      "Couldn't start pickup. Check your connection and try again.",
    );
  });

  it("logs the unexplained failure, with its prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    actionErrorMessage(boom, "Couldn't start your shift.", "[shift]");
    expect(spy).toHaveBeenCalledWith("[shift]", "Couldn't start your shift.", boom);
  });
});
