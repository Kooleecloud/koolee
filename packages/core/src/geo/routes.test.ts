import { describe, expect, it, vi } from "vitest";

import type { Coordinates } from "./coordinates";
import { HaversineEtaEstimator } from "./eta";
import { GoogleRoutesEtaEstimator } from "./routes";

const MIDTOWN: Coordinates = { lat: 40.75544, lng: -73.9927 };
const WILLIAMSBURG: Coordinates = { lat: 40.71277, lng: -73.95371 };
const JFK: Coordinates = { lat: 40.6446, lng: -73.7797 };

const haversine = new HaversineEtaEstimator();

/** A matrix response, one element per origin, durations in seconds. */
function matrix(seconds: (number | null)[]): Response {
  const body = seconds.map((s, originIndex) =>
    s === null
      ? { originIndex, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" }
      : {
          originIndex,
          destinationIndex: 0,
          condition: "ROUTE_EXISTS",
          duration: `${s}s`,
        },
  );
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function estimator(
  fetchImpl: typeof fetch,
  onFallback = vi.fn<(reason: string, detail?: Record<string, unknown>) => void>(),
) {
  return {
    estimator: new GoogleRoutesEtaEstimator({
      apiKey: "test-key",
      fetchImpl,
      onFallback,
    }),
    onFallback,
  };
}

describe("GoogleRoutesEtaEstimator — the request", () => {
  it("posts one route-matrix call with the key, the field mask and both ends", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(matrix([1800, 2400]));
    const { estimator: eta } = estimator(fetchImpl);

    await eta.estimateMany({ from: [MIDTOWN, WILLIAMSBURG], to: JFK });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    );
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    // The field mask is REQUIRED by the API and is also the billing lever.
    expect(headers["X-Goog-FieldMask"]).toBe(
      "originIndex,destinationIndex,duration,condition,status",
    );

    expect(JSON.parse(String(init?.body))).toEqual({
      origins: [
        {
          waypoint: { location: { latLng: { latitude: 40.75544, longitude: -73.9927 } } },
        },
        {
          waypoint: {
            location: { latLng: { latitude: 40.71277, longitude: -73.95371 } },
          },
        },
      ],
      destinations: [
        {
          waypoint: { location: { latLng: { latitude: 40.6446, longitude: -73.7797 } } },
        },
      ],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      units: "METRIC",
    });
  });

  it("makes ONE call for a whole shortlist, not one per driver", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(matrix([600, 900, 1200, 1500]));
    const { estimator: eta } = estimator(fetchImpl);

    await eta.estimateMany({ from: [MIDTOWN, WILLIAMSBURG, MIDTOWN, JFK], to: JFK });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call out at all for an empty batch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { estimator: eta } = estimator(fetchImpl);

    await expect(eta.estimateMany({ from: [], to: JFK })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GoogleRoutesEtaEstimator — the mapping", () => {
  it("turns a traffic-aware duration into an asymmetric five-minute range", async () => {
    // 3000s = 50 minutes. −15% → 42.5, floored to 40. +45% → 72.5, ceiled to 75.
    const { estimator: eta } = estimator(
      vi.fn<typeof fetch>().mockResolvedValue(matrix([3000])),
    );

    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual({
      minMinutes: 40,
      maxMinutes: 75,
    });
  });

  it("is far tighter than the arithmetic it replaces, in both directions", async () => {
    const { estimator: eta } = estimator(
      vi.fn<typeof fetch>().mockResolvedValue(matrix([3000])),
    );
    const routes = await eta.estimate({ from: MIDTOWN, to: JFK });
    const arithmetic = haversine.estimateSync({ from: MIDTOWN, to: JFK });

    // 75 vs 145: the monitor's pessimism drops from ~2.9x the real drive to
    // 1.5x — a margin somebody chose rather than an artifact of 18 km/h.
    expect(routes.maxMinutes).toBeLessThan(arithmetic.maxMinutes);
    expect(routes.maxMinutes).toBeGreaterThan(50);
  });

  it("keeps the floor and the always-a-range rule", async () => {
    const { estimator: eta } = estimator(
      vi.fn<typeof fetch>().mockResolvedValue(matrix([30])),
    );
    await expect(eta.estimate({ from: JFK, to: JFK })).resolves.toEqual({
      minMinutes: 5,
      maxMinutes: 10,
    });
  });

  it("keeps origins aligned even when the API answers out of order", async () => {
    const body = [
      {
        originIndex: 1,
        destinationIndex: 0,
        condition: "ROUTE_EXISTS",
        duration: "3000s",
      },
      {
        originIndex: 0,
        destinationIndex: 0,
        condition: "ROUTE_EXISTS",
        duration: "600s",
      },
    ];
    const { estimator: eta } = estimator(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );

    const [first, second] = await eta.estimateMany({
      from: [MIDTOWN, WILLIAMSBURG],
      to: JFK,
    });
    expect(first).toEqual({ minMinutes: 5, maxMinutes: 15 });
    expect(second).toEqual({ minMinutes: 40, maxMinutes: 75 });
  });
});

describe("GoogleRoutesEtaEstimator — it never throws", () => {
  const expected = haversine.estimateSync({ from: MIDTOWN, to: JFK });

  it("falls back on a network failure", async () => {
    const { estimator: eta, onFallback } = estimator(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNRESET")),
    );

    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
    expect(onFallback).toHaveBeenCalledWith("request failed", expect.anything());
  });

  it.each([
    ["a revoked or unrestricted key", 403],
    ["quota exhaustion", 429],
    ["their outage", 503],
  ])("falls back on %s", async (_label, status) => {
    const { estimator: eta, onFallback } = estimator(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status })),
    );

    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
    expect(onFallback).toHaveBeenCalledWith("non-2xx response", { status });
  });

  it("falls back on a body that is not JSON", async () => {
    const { estimator: eta } = estimator(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("<html>502</html>", { status: 200 })),
    );
    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
  });

  it("falls back on a body that is JSON but not a matrix", async () => {
    const { estimator: eta, onFallback } = estimator(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "nope" }), { status: 200 }),
        ),
    );
    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
    expect(onFallback).toHaveBeenCalledWith("unexpected response shape");
  });

  it("falls back PER ORIGIN — one unroutable driver does not cost the others", async () => {
    const { estimator: eta } = estimator(
      vi.fn<typeof fetch>().mockResolvedValue(matrix([3000, null])),
    );

    const [routed, unroutable] = await eta.estimateMany({
      from: [MIDTOWN, WILLIAMSBURG],
      to: JFK,
    });
    expect(routed).toEqual({ minMinutes: 40, maxMinutes: 75 });
    expect(unroutable).toEqual(haversine.estimateSync({ from: WILLIAMSBURG, to: JFK }));
  });

  it("falls back on an element whose status carries an error code", async () => {
    const body = [
      {
        originIndex: 0,
        destinationIndex: 0,
        condition: "ROUTE_EXISTS",
        duration: "3000s",
        status: { code: 3, message: "invalid waypoint" },
      },
    ];
    const { estimator: eta } = estimator(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
  });

  it.each([
    ["a duration with no unit", "1800"],
    ["a duration that is not a number", "abcs"],
    ["no duration at all", undefined],
  ])("falls back on %s", async (_label, duration) => {
    const body = [
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", duration },
    ];
    const { estimator: eta } = estimator(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(eta.estimate({ from: MIDTOWN, to: JFK })).resolves.toEqual(expected);
  });
});
