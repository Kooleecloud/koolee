import { describe, expect, it } from "vitest";

import { newId } from "./ids";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("mints RFC 4122 v4 uuids the server's z.uuid() accepts", () => {
    for (let i = 0; i < 200; i += 1) expect(newId()).toMatch(V4);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(seen.size).toBe(1000);
  });

  it("needs only getRandomValues — the one thing the Hermes polyfill provides", () => {
    const original = globalThis.crypto;
    const onlyRandomValues = {
      getRandomValues: original.getRandomValues.bind(original),
    } as unknown as Crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: onlyRandomValues,
      configurable: true,
    });
    try {
      expect(newId()).toMatch(V4);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});
