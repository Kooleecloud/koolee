import { describe, expect, it } from "vitest";

import { maskPhone, normalizeSupabasePhone, toE164UsCa } from "./phone";

describe("toE164UsCa", () => {
  it("formats a bare 10-digit US number", () => {
    expect(toE164UsCa("3322602829")).toBe("+13322602829");
  });

  it("accepts human formatting", () => {
    expect(toE164UsCa("(332) 260-2829")).toBe("+13322602829");
    expect(toE164UsCa("332-260-2829")).toBe("+13322602829");
    expect(toE164UsCa("+1 332 260 2829")).toBe("+13322602829");
  });

  it("accepts an 11-digit number with country code", () => {
    expect(toE164UsCa("13322602829")).toBe("+13322602829");
  });

  it("accepts Canadian numbers (shared +1)", () => {
    expect(toE164UsCa("+1 604 555 0199")).toBe("+16045550199");
  });

  it("rejects short, invalid and non-US/CA numbers", () => {
    expect(toE164UsCa("")).toBeNull();
    expect(toE164UsCa("123")).toBeNull();
    expect(toE164UsCa("+44 20 7946 0958")).toBeNull(); // UK
    expect(toE164UsCa("not a phone")).toBeNull();
  });

  it("rejects invalid NANP area codes", () => {
    expect(toE164UsCa("0002602829")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("shows only the last four digits", () => {
    expect(maskPhone("+13322602829")).toBe("•••-••2829");
  });
});

describe("normalizeSupabasePhone", () => {
  it("adds the leading + Supabase strips", () => {
    expect(normalizeSupabasePhone("13322602829")).toBe("+13322602829");
    expect(normalizeSupabasePhone("+13322602829")).toBe("+13322602829");
    expect(normalizeSupabasePhone(null)).toBeNull();
    expect(normalizeSupabasePhone(undefined)).toBeNull();
  });
});
