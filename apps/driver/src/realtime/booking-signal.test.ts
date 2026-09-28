import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));

import { signalKey, touchedByOf } from "./booking-signal";

describe("signalKey", () => {
  it("is the same key for the same bookings in any order, once each", () => {
    expect(signalKey(["b", "a"])).toBe("a,b");
    expect(signalKey(["a", "b", "a", ""])).toBe("a,b");
    expect(signalKey([])).toBe("");
  });
});

describe("touchedByOf", () => {
  it("reads who touched the signal from a postgres_changes payload", () => {
    expect(
      touchedByOf({
        eventType: "UPDATE",
        new: { booking_id: "b", touched_by: "user-1" },
      }),
    ).toBe("user-1");
  });

  it("says null for anything without one, so the change is NOT skipped", () => {
    expect(touchedByOf({ new: { booking_id: "b", touched_by: null } })).toBeNull();
    expect(touchedByOf({ eventType: "DELETE", old: { booking_id: "b" } })).toBeNull();
    expect(touchedByOf(undefined)).toBeNull();
    expect(touchedByOf("x")).toBeNull();
  });
});
