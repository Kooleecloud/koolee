import type { Coordinates } from "./coordinates";

/**
 * Google Places (New) — address autocomplete, and the one lookup that turns a
 * chosen suggestion into structured fields plus a point.
 *
 * Beside `GoogleRoutesEtaEstimator` and for the same reasons: one
 * implementation in core, importable server-side by any app, plain `fetch`
 * with no SDK, and the key arriving as a VALUE because core reads no
 * environment.
 *
 * **THE KEY NEVER REACHES A BROWSER.** Places (New) has no browser-safe mode
 * that avoids that — the JS widget wants a key restricted by HTTP referrer,
 * which is a key anyone can read out of the bundle and spend. So the funnel
 * calls a thin server route in `apps/web`, the route calls this, and the
 * server key is restricted to a server. That is also why there is no
 * `@googlemaps/*` dependency anywhere in this repository.
 *
 * **SESSION TOKENS ARE BILLING, NOT PLUMBING.** Google bills a whole typing
 * session as one autocomplete + one details call IF every request carries the
 * same session token and the session ends with a details call. Without a
 * token, every keystroke that reaches the API is billed separately. The token
 * is minted by the browser (it is opaque), travels through the route, and is
 * discarded after the details call — reusing one afterwards is billed as a
 * fresh session anyway.
 *
 * **IT NEVER THROWS.** Autocomplete is an assist, never a gate: the address
 * step works exactly as it always has with the field typed by hand, so any
 * failure returns no suggestions and logs one line.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/**
 * Only what the address step fills in. The field mask is required, and on
 * Places it is also what decides the SKU: asking for `addressComponents` and
 * `location` keeps the details call in the tier the session token covers.
 */
const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat";
const DETAILS_FIELD_MASK = "id,formattedAddress,addressComponents,location";

/**
 * The service area, as a rectangle, so a customer typing "22 W" is offered
 * doorsteps Koolee can actually reach rather than every street in the country.
 * Generous on purpose — it is a bias for the suggestion list, not a coverage
 * check. Coverage is `ALL_COVERAGE_ZIPS` and is enforced server-side on submit,
 * where it has always been.
 */
const SERVICE_AREA = {
  low: { latitude: 40.45, longitude: -74.35 },
  high: { latitude: 41.0, longitude: -73.65 },
};

/** Shorter than this is not an address, and every keystroke is a billed call. */
export const MIN_AUTOCOMPLETE_INPUT = 3;

const DEFAULT_TIMEOUT_MS = 3000;

export interface PlaceSuggestion {
  placeId: string;
  /** The whole suggestion, e.g. "22 W 34th St, New York, NY, USA". */
  description: string;
  /** The street line on its own, when Places separates it out. */
  mainText?: string;
  /** The rest — city, state, country. */
  secondaryText?: string;
}

export interface PlaceAddress {
  placeId: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  coordinates: Coordinates | null;
}

export interface GooglePlacesClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onFailure?: (reason: string, detail?: Record<string, unknown>) => void;
}

/** Places returns components with a `types` array; this pulls one out. */
function componentOf(
  components: { types?: string[]; longText?: string; shortText?: string }[],
  type: string,
  form: "long" | "short" = "long",
): string {
  const match = components.find((c) => c.types?.includes(type));
  const value = form === "short" ? match?.shortText : match?.longText;
  return value ?? "";
}

export class GooglePlacesClient {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #onFailure: (reason: string, detail?: Record<string, unknown>) => void;

  constructor(options: GooglePlacesClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#onFailure =
      options.onFailure ??
      ((reason, detail) => {
        console.warn(`[places] ${reason}`, detail ?? {});
      });
  }

  /** Suggestions for what has been typed so far. Empty on anything unusual. */
  async autocomplete(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
    const query = input.trim();
    if (query.length < MIN_AUTOCOMPLETE_INPUT) return [];

    const body = await this.#post(AUTOCOMPLETE_URL, AUTOCOMPLETE_FIELD_MASK, {
      input: query,
      // Addresses, not restaurants: a customer's doorstep is a street address,
      // a building or a unit within one.
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
      locationRestriction: { rectangle: SERVICE_AREA },
      ...(sessionToken ? { sessionToken } : {}),
    });
    if (body === null) return [];

    const suggestions = (body as { suggestions?: unknown }).suggestions;
    if (!Array.isArray(suggestions)) return [];

    return suggestions.flatMap((raw): PlaceSuggestion[] => {
      const prediction = (
        raw as {
          placePrediction?: {
            placeId?: string;
            text?: { text?: string };
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }
      ).placePrediction;
      const placeId = prediction?.placeId;
      if (typeof placeId !== "string" || placeId.length === 0) return [];

      const mainText = prediction?.structuredFormat?.mainText?.text;
      const secondaryText = prediction?.structuredFormat?.secondaryText?.text;
      return [
        {
          placeId,
          description:
            prediction?.text?.text ??
            [mainText, secondaryText].filter(Boolean).join(", "),
          ...(mainText === undefined ? {} : { mainText }),
          ...(secondaryText === undefined ? {} : { secondaryText }),
        },
      ];
    });
  }

  /**
   * The chosen suggestion, as fields the form can fill and a point the price
   * and the ETA can use.
   *
   * `line1` is `street_number + route`, which is what the address step's own
   * field means. A `subpremise` (an apartment number Places happened to know)
   * is deliberately NOT folded in: the form has its own line for that and the
   * customer is the authority on their buzzer.
   *
   * Null when anything is missing — a suggestion with no ZIP cannot be
   * reconciled against the quoted ZIP, and guessing one is how a booking gets
   * priced for the wrong place.
   */
  async details(placeId: string, sessionToken?: string): Promise<PlaceAddress | null> {
    const url = new URL(`${DETAILS_URL}/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

    const body = await this.#get(url, DETAILS_FIELD_MASK);
    if (body === null) return null;

    const place = body as {
      id?: string;
      formattedAddress?: string;
      addressComponents?: { types?: string[]; longText?: string; shortText?: string }[];
      location?: { latitude?: number; longitude?: number };
    };
    const components = place.addressComponents ?? [];

    const streetNumber = componentOf(components, "street_number");
    const route = componentOf(components, "route");
    const city =
      componentOf(components, "locality") ||
      componentOf(components, "sublocality_level_1") ||
      componentOf(components, "postal_town");
    const state = componentOf(components, "administrative_area_level_1", "short");
    const zip = componentOf(components, "postal_code");

    const line1 = [streetNumber, route].filter(Boolean).join(" ");
    if (!line1 || !city || !state || !zip) {
      this.#onFailure("details missing a required component", { placeId });
      return null;
    }

    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    return {
      placeId: place.id ?? placeId,
      line1,
      city,
      state,
      zip,
      formatted: place.formattedAddress ?? line1,
      coordinates:
        typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
    };
  }

  async #post(url: string, fieldMask: string, body: unknown): Promise<unknown> {
    return this.#request(url, fieldMask, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  async #get(url: URL, fieldMask: string): Promise<unknown> {
    return this.#request(url.toString(), fieldMask, { method: "GET" });
  }

  async #request(url: string, fieldMask: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          "X-Goog-Api-Key": this.#apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      this.#onFailure("request failed", { error: String(error) });
      return null;
    }

    if (!response.ok) {
      this.#onFailure("non-2xx response", { status: response.status });
      return null;
    }

    try {
      return await response.json();
    } catch (error) {
      this.#onFailure("unparseable response", { error: String(error) });
      return null;
    }
  }
}
