import { describe, expect, it, vi } from "vitest";

import { GooglePlacesClient, MIN_AUTOCOMPLETE_INPUT } from "./places";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(fetchImpl: typeof fetch, onFailure = vi.fn()) {
  return {
    places: new GooglePlacesClient({ apiKey: "test-key", fetchImpl, onFailure }),
    onFailure,
  };
}

const SUGGESTION = {
  placePrediction: {
    placeId: "ChIJ_1",
    text: { text: "22 W 34th St, New York, NY, USA" },
    structuredFormat: {
      mainText: { text: "22 W 34th St" },
      secondaryText: { text: "New York, NY, USA" },
    },
  },
};

const DETAILS = {
  id: "ChIJ_1",
  formattedAddress: "22 W 34th St, New York, NY 10001, USA",
  location: { latitude: 40.749, longitude: -73.9871 },
  addressComponents: [
    { types: ["street_number"], longText: "22", shortText: "22" },
    { types: ["route"], longText: "West 34th Street", shortText: "W 34th St" },
    { types: ["locality", "political"], longText: "New York", shortText: "New York" },
    {
      types: ["administrative_area_level_1", "political"],
      longText: "New York",
      shortText: "NY",
    },
    { types: ["postal_code"], longText: "10001", shortText: "10001" },
    { types: ["subpremise"], longText: "Apt 4B", shortText: "4B" },
  ],
};

describe("GooglePlacesClient.autocomplete", () => {
  it("asks for addresses in the service area, with the key and the field mask", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ suggestions: [] }));
    const { places } = client(fetchImpl);

    await places.autocomplete("22 W 34", "session-1");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toContain("suggestions.placePrediction.placeId");

    expect(JSON.parse(String(init?.body))).toMatchObject({
      input: "22 W 34",
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
      sessionToken: "session-1",
    });
  });

  it("does not call out below the minimum input length — every keystroke is billed", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { places } = client(fetchImpl);

    await expect(
      places.autocomplete("2".repeat(MIN_AUTOCOMPLETE_INPUT - 1)),
    ).resolves.toEqual([]);
    await expect(places.autocomplete("   ")).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a suggestion into a street line and the rest", async () => {
    const { places } = client(
      vi.fn<typeof fetch>().mockResolvedValue(json({ suggestions: [SUGGESTION] })),
    );

    await expect(places.autocomplete("22 W 34")).resolves.toEqual([
      {
        placeId: "ChIJ_1",
        description: "22 W 34th St, New York, NY, USA",
        mainText: "22 W 34th St",
        secondaryText: "New York, NY, USA",
      },
    ]);
  });

  it("drops a suggestion with no place id rather than offering a dead row", async () => {
    const { places } = client(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ suggestions: [{ placePrediction: {} }, SUGGESTION] })),
    );

    await expect(places.autocomplete("22 W 34")).resolves.toHaveLength(1);
  });

  it.each([
    ["a network failure", () => Promise.reject(new Error("ECONNRESET"))],
    ["a 403", () => Promise.resolve(json({}, 403))],
    ["a 429", () => Promise.resolve(json({}, 429))],
    [
      "a body that is not JSON",
      () => Promise.resolve(new Response("<html>", { status: 200 })),
    ],
    ["a body with no suggestions", () => Promise.resolve(json({ error: "nope" }))],
  ])("returns no suggestions on %s", async (_label, impl) => {
    const { places } = client(vi.fn<typeof fetch>().mockImplementation(impl as never));
    await expect(places.autocomplete("22 W 34")).resolves.toEqual([]);
  });
});

describe("GooglePlacesClient.details", () => {
  it("returns the fields the address step fills, plus a point", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(DETAILS));
    const { places } = client(fetchImpl);

    const address = await places.details("ChIJ_1", "session-1");

    expect(address).toEqual({
      placeId: "ChIJ_1",
      // street_number + route, and NOT the subpremise: the form has its own
      // line for a buzzer and the customer is the authority on it.
      line1: "22 West 34th Street",
      city: "New York",
      // The SHORT form — the form's field is maxLength 2.
      state: "NY",
      zip: "10001",
      formatted: "22 W 34th St, New York, NY 10001, USA",
      coordinates: { lat: 40.749, lng: -73.9871 },
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://places.googleapis.com/v1/places/ChIJ_1?sessionToken=session-1",
    );
  });

  it("returns null when a required component is missing", async () => {
    // No ZIP: a suggestion whose ZIP we would have to guess cannot be
    // reconciled against the quoted ZIP, and guessing prices the wrong place.
    const withoutZip = {
      ...DETAILS,
      addressComponents: DETAILS.addressComponents.filter(
        (c) => !c.types.includes("postal_code"),
      ),
    };
    const { places, onFailure } = client(
      vi.fn<typeof fetch>().mockResolvedValue(json(withoutZip)),
    );

    await expect(places.details("ChIJ_1")).resolves.toBeNull();
    expect(onFailure).toHaveBeenCalledWith("details missing a required component", {
      placeId: "ChIJ_1",
    });
  });

  it("returns an address with no coordinates rather than nothing", async () => {
    const withoutLocation = { ...DETAILS, location: undefined };
    const { places } = client(
      vi.fn<typeof fetch>().mockResolvedValue(json(withoutLocation)),
    );

    const address = await places.details("ChIJ_1");
    expect(address?.coordinates).toBeNull();
    expect(address?.zip).toBe("10001");
  });

  it("returns null on a failure instead of throwing", async () => {
    const { places } = client(vi.fn<typeof fetch>().mockResolvedValue(json({}, 500)));
    await expect(places.details("ChIJ_1")).resolves.toBeNull();
  });
});
