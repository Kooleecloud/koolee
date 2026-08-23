import { describe, expect, it } from "vitest";

import type { TypedBookingDraft } from "./booking-draft-schema";
import { nextIncompleteStep, stepCompletion, stepIsUnlocked } from "./booking-steps";

/**
 * The unlock model behind the progressive stepper: steps unlock in order,
 * completed steps stay jumpable, and edits resume at the frontier.
 */

const FLIGHT: TypedBookingDraft = {
  zip: "10001",
  flightNumber: "UA1189",
  airlineIata: "UA",
  departureAirport: "EWR",
  departureAt: "2026-09-14T14:30:00.000Z",
  scope: "domestic",
  paxName: "Jordan Alvarez",
};

const PICKUP: TypedBookingDraft = {
  ...FLIGHT,
  line1: "350 5th Ave",
  city: "New York",
  state: "NY",
  bagCount: 2,
};

const SLOT: TypedBookingDraft = {
  ...PICKUP,
  windowStart: "2026-09-13T14:00:00.000Z",
  windowEnd: "2026-09-13T15:00:00.000Z",
};

describe("nextIncompleteStep", () => {
  it("starts an empty draft at the flight step", () => {
    expect(nextIncompleteStep({})).toBe("/book/flight");
  });

  it("walks the funnel in order", () => {
    expect(nextIncompleteStep(FLIGHT)).toBe("/book/pickup");
    expect(nextIncompleteStep(PICKUP)).toBe("/book/slot");
    expect(nextIncompleteStep(SLOT)).toBe("/book/pay");
  });

  it("bounces back to flight when only later steps are filled", () => {
    expect(nextIncompleteStep({ line1: "350 5th Ave", bagCount: 2 })).toBe(
      "/book/flight",
    );
  });

  it("returns to slot when a flight edit invalidated the window", () => {
    expect(
      nextIncompleteStep({ ...PICKUP, windowStart: undefined, windowEnd: undefined }),
    ).toBe("/book/slot");
  });
});

describe("stepIsUnlocked", () => {
  it("only the first step is unlocked on an empty draft", () => {
    expect(stepIsUnlocked({}, "/book/flight")).toBe(true);
    expect(stepIsUnlocked({}, "/book/pickup")).toBe(false);
    expect(stepIsUnlocked({}, "/book/slot")).toBe(false);
    expect(stepIsUnlocked({}, "/book/pay")).toBe(false);
  });

  it("unlocks steps as their predecessors complete", () => {
    expect(stepIsUnlocked(FLIGHT, "/book/pickup")).toBe(true);
    expect(stepIsUnlocked(FLIGHT, "/book/slot")).toBe(false);
    expect(stepIsUnlocked(PICKUP, "/book/slot")).toBe(true);
    expect(stepIsUnlocked(PICKUP, "/book/pay")).toBe(false);
    expect(stepIsUnlocked(SLOT, "/book/pay")).toBe(true);
  });

  it("keeps earlier steps unlocked for edits from later ones", () => {
    expect(stepIsUnlocked(SLOT, "/book/flight")).toBe(true);
    expect(stepIsUnlocked(SLOT, "/book/pickup")).toBe(true);
  });
});

describe("stepCompletion", () => {
  it("never marks the pay step complete (a booking clears the draft)", () => {
    expect(stepCompletion(SLOT)).toEqual([true, true, true, false]);
  });

  it("requires the ZIP as part of the flight step", () => {
    expect(stepCompletion({ ...FLIGHT, zip: undefined })[0]).toBe(false);
  });
});
