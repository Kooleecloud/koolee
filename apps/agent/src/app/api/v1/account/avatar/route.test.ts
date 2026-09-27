import { describe, expect, it } from "vitest";

import * as route from "./route";

describe("POST/DELETE /api/v1/account/avatar — route shape", () => {
  it("exports POST and DELETE handlers and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect(typeof route.DELETE).toBe("function");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("exposes no GET — the picture is read through /me", () => {
    expect("GET" in route).toBe(false);
  });
});
