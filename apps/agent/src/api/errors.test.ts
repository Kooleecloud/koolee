import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookingNotActionableError,
  ConflictError,
  InvalidInputError,
  NotAuthenticatedError,
  NotAuthorizedError,
  NotFoundError,
} from "@koolee/core";

import { ApiHttpError, refused, toApiHttpError, TRANSPORT_FALLBACK } from "./errors";

describe("toApiHttpError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a domain refusal through verbatim with a stable code and status", () => {
    const cases: Array<[Error, string, number]> = [
      [new NotAuthenticatedError("No valid session."), "not_authorized", 401],
      [new NotAuthorizedError("role admin not permitted"), "forbidden", 403],
      [new NotFoundError("Pickup task", "t1"), "not_found", 404],
      [
        new InvalidInputError("truckId", "Van 3 is out of service."),
        "invalid_input",
        400,
      ],
      [new ConflictError("seal", "That seal is on another bag."), "conflict", 409],
      [
        new BookingNotActionableError(
          "startVisit",
          "terminal",
          "departed",
          "This booking was cancelled.",
        ),
        "booking_not_actionable",
        409,
      ],
    ];
    for (const [error, code, status] of cases) {
      const mapped = toApiHttpError(error);
      expect(mapped.body.error).toBe(code);
      expect(mapped.status).toBe(status);
      expect(mapped.body.message).toBe(error.message);
    }
  });

  it("carries the field and the standing/phase so the app can point at the right control", () => {
    expect(toApiHttpError(new ConflictError("seal", "x")).body.field).toBe("seal");
    expect(toApiHttpError(new InvalidInputError("weightKg", "x")).body.field).toBe(
      "weightKg",
    );
    const blocked = toApiHttpError(
      new BookingNotActionableError(
        "startPickup",
        "exception",
        "running_late",
        "Ops has it.",
      ),
    );
    expect(blocked.body.standing).toBe("exception");
    expect(blocked.body.phase).toBe("running_late");
  });

  it("turns core's not-on-shift refusal into 409 only where the route asks for it", () => {
    const error = new NotAuthorizedError(
      "Not on shift — positions are only recorded on shift.",
    );
    expect(toApiHttpError(error).status).toBe(403);
    const positions = toApiHttpError(error, { notOnShift: true });
    expect(positions.status).toBe(409);
    expect(positions.body.error).toBe("not_on_shift");
  });

  it("hides anything that is not a deliberate refusal behind the connection fallback, and logs it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mapped = toApiHttpError(new TypeError("fetch failed"), {
      logPrefix: "[api/test]",
    });
    expect(mapped.status).toBe(500);
    expect(mapped.body).toEqual({ error: "internal", message: TRANSPORT_FALLBACK });
    expect(log).toHaveBeenCalledWith("[api/test]", expect.any(TypeError));
  });

  it("returns an ApiHttpError untouched and builds a 422 for a core { ok: false }", () => {
    const own = new ApiHttpError("unavailable", "Down.");
    expect(toApiHttpError(own)).toBe(own);
    const r = refused("Booking is paid — a pickup starts once the bags are sealed.");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("refused");
  });
});
