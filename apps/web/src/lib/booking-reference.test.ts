import { describe, expect, it } from "vitest";

import { bookingReference } from "./booking-reference";

describe("bookingReference", () => {
  it("takes the last six hex characters of the id", () => {
    expect(bookingReference("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("KL-2C3301");
  });

  it("is stable for the same id", () => {
    const id = "0b2545aa-1111-2222-3333-9f8e7d6c5b4a";
    expect(bookingReference(id)).toBe(bookingReference(id));
  });

  it("ignores dashes rather than counting them as characters", () => {
    // Same trailing hex, different dash placement — the code must not move.
    expect(bookingReference("aaaaaaaa-bbbb-cccc-dddd-000000abcdef")).toBe("KL-ABCDEF");
  });

  it("uppercases lowercase input", () => {
    expect(bookingReference("00000000-0000-0000-0000-0000000000ff")).toBe("KL-0000FF");
  });

  it("degrades rather than throwing on a short or malformed id", () => {
    expect(() => bookingReference("")).not.toThrow();
    expect(() => bookingReference("xyz")).not.toThrow();
  });
});
