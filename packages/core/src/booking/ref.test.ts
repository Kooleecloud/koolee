import { describe, expect, it, vi } from "vitest";

import {
  BOOKING_REF_MAX_ATTEMPTS,
  BOOKING_REF_PATTERN,
  BOOKING_REF_PREFIX,
  generateBookingRef,
  isBookingRefConflict,
  withBookingRef,
} from "./ref";

/** What the real driver throws: a wrapped postgres-js unique violation. */
function refConflict(): Error {
  const driverError = Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint_name: "bookings_ref_key",
  });
  return Object.assign(new Error("Failed query"), { cause: driverError });
}

describe("generateBookingRef", () => {
  it("produces KOO- plus five Crockford base32 characters", () => {
    for (let i = 0; i < 500; i += 1) {
      const ref = generateBookingRef();
      expect(ref).toMatch(BOOKING_REF_PATTERN);
      expect(ref).toHaveLength(9);
      expect(ref.startsWith(BOOKING_REF_PREFIX)).toBe(true);
    }
  });

  it("never emits a character a human can misread", () => {
    // I/L/O/U are the point of Crockford base32 — 500 refs is 2,500 draws,
    // which would surface any of them if the alphabet were wrong.
    const payloads = Array.from({ length: 500 }, () => generateBookingRef().slice(4));
    expect(payloads.join("")).not.toMatch(/[ILOU]/);
  });

  it("uses the whole alphabet — no dead characters", () => {
    const seen = new Set(
      Array.from({ length: 2000 }, () => generateBookingRef().slice(4)).join(""),
    );
    expect(seen.size).toBe(32);
  });

  /*
   * NOT `toBe(1000)`. The birthday bound over 32^5 gives ~1.5% odds of at
   * least one duplicate in 1,000 draws, so a strict assertion here is a test
   * that fails roughly once every 67 runs — which is exactly what it did.
   *
   * Perfect uniqueness is not the generator's job; it is the unique index's,
   * with `withBookingRef` retrying the loser. What IS the generator's job is
   * entropy, and a threshold catches every way that can break (a constant, a
   * stuck seed, a truncated alphabet) without inheriting the flake.
   */
  it("draws with full entropy — near-perfect distinctness over 1,000 refs", () => {
    const refs = new Set(Array.from({ length: 1000 }, generateBookingRef));
    expect(refs.size).toBeGreaterThan(990);
  });
});

describe("isBookingRefConflict", () => {
  it("recognises a wrapped 23505 on bookings_ref_key", () => {
    expect(isBookingRefConflict(refConflict())).toBe(true);
  });

  it("ignores a unique violation on a DIFFERENT index", () => {
    const other = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("dup"), {
        code: "23505",
        constraint_name: "bags_seal_id_key",
      }),
    });
    expect(isBookingRefConflict(other)).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isBookingRefConflict(new Error("connection reset"))).toBe(false);
    expect(isBookingRefConflict(null)).toBe(false);
  });
});

describe("withBookingRef", () => {
  it("passes a well-formed ref through on the first attempt", async () => {
    const attempt = vi.fn((ref: string) => Promise.resolve(ref));
    const result = await withBookingRef(attempt);

    expect(attempt).toHaveBeenCalledOnce();
    expect(result).toMatch(BOOKING_REF_PATTERN);
  });

  it("retries with a NEW ref on a ref collision", async () => {
    const seen: string[] = [];
    let calls = 0;
    const result = await withBookingRef(async (ref) => {
      seen.push(ref);
      calls += 1;
      if (calls < 3) throw refConflict();
      return ref;
    });

    expect(calls).toBe(3);
    expect(new Set(seen).size).toBe(3);
    expect(result).toBe(seen[2]);
  });

  it("gives up after the bounded number of attempts and rethrows", async () => {
    let calls = 0;
    await expect(
      withBookingRef(async () => {
        calls += 1;
        throw refConflict();
      }),
    ).rejects.toMatchObject({ message: "Failed query" });

    expect(calls).toBe(BOOKING_REF_MAX_ATTEMPTS);
  });

  it("does NOT retry an unrelated failure — it propagates on the first throw", async () => {
    let calls = 0;
    await expect(
      withBookingRef(async () => {
        calls += 1;
        throw new Error("connection reset");
      }),
    ).rejects.toThrow("connection reset");

    expect(calls).toBe(1);
  });
});
