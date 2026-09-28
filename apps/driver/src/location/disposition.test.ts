import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ accessTokenResult: vi.fn() }));
vi.mock("../lib/env", () => ({ env: { apiUrl: "http://api.test" } }));

import { ApiRequestError, NetworkError } from "../lib/api";
import { positionBatchDisposition } from "./disposition";

function refused(status: number, error: string) {
  return new ApiRequestError(status, { error: error as never, message: "x" }, "x");
}

describe("positionBatchDisposition", () => {
  it("keeps a batch that a later attempt can deliver", () => {
    expect(positionBatchDisposition(new NetworkError(new Error("offline")))).toBe("keep");
    expect(positionBatchDisposition(refused(503, "unavailable"))).toBe("keep");
    expect(positionBatchDisposition(refused(500, "internal"))).toBe("keep");
    // The session lapsed, not the fixes: after sign-in they are still good.
    expect(positionBatchDisposition(refused(401, "not_authorized"))).toBe("keep");
  });

  it("drops a batch no attempt will ever deliver", () => {
    expect(positionBatchDisposition(refused(409, "not_on_shift"))).toBe("drop");
    expect(positionBatchDisposition(refused(400, "invalid_body"))).toBe("drop");
    expect(positionBatchDisposition(refused(403, "forbidden"))).toBe("drop");
  });
});
