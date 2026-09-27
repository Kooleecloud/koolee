import { describe, expect, it } from "vitest";

import {
  avatarLabelFor,
  initialsFor,
  TINTS,
  tintFor,
  tintIndexFor,
} from "./avatar-fallback";

describe("initialsFor", () => {
  it("takes the first letter of the first and last words", () => {
    expect(initialsFor("Ana Maria Ruiz")).toBe("AR");
    expect(initialsFor("ravi")).toBe("R");
    expect(initialsFor("  jo   bloggs  ")).toBe("JB");
  });

  it("is empty for nothing", () => {
    expect(initialsFor("")).toBe("");
    expect(initialsFor("   ")).toBe("");
    expect(initialsFor(null)).toBe("");
    expect(initialsFor(undefined)).toBe("");
  });
});

describe("tintIndexFor", () => {
  it("matches packages/ui's hash (hash*31 + code | 0, abs % 3)", () => {
    // Computed by hand with the web formula so a drift in either copy shows.
    let hash = 0;
    for (const ch of "Ana Maria Ruiz") hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    expect(tintIndexFor("Ana Maria Ruiz")).toBe(Math.abs(hash) % 3);
    expect(tintIndexFor("")).toBe(0);
  });

  it("is stable and always lands on a brand tint", () => {
    for (const name of ["Ravi", "Ana Maria Ruiz", "x", "Ops Team", "李雷"]) {
      const index = tintIndexFor(name);
      expect(index).toBe(tintIndexFor(name));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(TINTS.length);
      expect(tintFor(name)).toBe(TINTS[index]);
    }
  });
});

describe("avatarLabelFor", () => {
  it("announces the name by default", () => {
    expect(avatarLabelFor("Ana Maria Ruiz", undefined)).toBe("Ana Maria Ruiz");
    expect(avatarLabelFor(null, undefined)).toBe("");
  });

  it("lets an explicit alt win, including the empty one that silences it", () => {
    expect(avatarLabelFor("Ana Maria Ruiz", "Customer photo")).toBe("Customer photo");
    expect(avatarLabelFor("Ana Maria Ruiz", "")).toBe("");
  });
});
