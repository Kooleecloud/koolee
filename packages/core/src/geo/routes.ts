import { type Coordinates } from "./coordinates";
import {
  HaversineEtaEstimator,
  toEtaRange,
  type EtaBatchQuery,
  type EtaEstimator,
  type EtaQuery,
  type EtaRange,
  type EtaRangeShape,
} from "./eta";

/**
 * The traffic-aware ETA, from Google's Routes API.
 *
 * ONE implementation, in core, importable server-side by every app — the
 * `WebPushSender` lesson. When the real sender lived in `apps/web`, the other
 * two apps silently fell back to a console stub that REPORTED SUCCESS. An ETA
 * adapter cannot go wrong in quite that way (it degrades to arithmetic, which
 * is honest), but the shape of the mistake is the same: a seam implemented
 * next to one consumer is a seam the other consumers do not have.
 *
 * Plain `fetch`, no SDK. `computeRouteMatrix` is one POST with a field mask;
 * a client library for it would be a dependency, a bundle risk and a second
 * place for the auth header to live.
 *
 * **Core reads no environment.** The key arrives as a value, resolved by each
 * app from its own validated env — the same contract `payments: {kind:
 * "stripe", secretKey}` already uses.
 *
 * **IT NEVER THROWS AND NEVER MAKES A CALLER WAIT LONG.** ETA is not
 * load-bearing: nothing about a booking, a price, a gate or a transition
 * depends on one. So every failure — quota, network, a revoked key, a route
 * that does not exist, a slow response — falls back to the haversine estimate
 * and logs one line. A page that renders a slightly worse ETA is fine; a page
 * that 500s because a third party is down is not.
 */

/** The matrix endpoint. Origins × destinations in one POST. */
const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/**
 * Only the four fields that matter. The field mask is REQUIRED by the Routes
 * API — an unmasked request is rejected — and it is also the billing lever:
 * asking for `duration` alone keeps the call in the cheaper tier.
 */
const FIELD_MASK = "originIndex,destinationIndex,duration,condition,status";

/**
 * A routing answer is far better than 18 km/h arithmetic, so the band tightens
 * — but NOT symmetrically, and that asymmetry is the whole decision here.
 *
 * The Tier 5 pre-flight (§1.3, §6.1) flagged the risk plainly: narrowing the
 * range makes `cutoffRiskMonitor` alert LATER, because the monitor consumes
 * `maxMinutes`. Under haversine, Midtown → JFK reads 145 minutes against a
 * real ~50 — an accidental 2.9× safety margin that also fires the alert on
 * bookings that are completely fine, which is how operators learn to ignore
 * an alert.
 *
 * The answer is to make the margin deliberate instead of accidental, and to
 * put it where the uncertainty actually is. A drive can always take longer
 * than predicted (an incident, a bridge, a double-parked truck on the last
 * block); it essentially never takes dramatically less. So: −15% at the low
 * end, +45% at the high end. For a 50-minute route that is 40–75 minutes —
 * honest for the customer reading "when do I need to be at the door", and a
 * 1.5× margin for the monitor, which is a margin somebody chose.
 *
 * The monitor's own maths is untouched by this: it still takes the pessimistic
 * end of whatever the seam returns.
 */
const ROUTES_SHAPE: EtaRangeShape = {
  lowSpread: 0.15,
  highSpread: 0.45,
  floorMinutes: HaversineEtaEstimator.FLOOR_MINUTES,
  stepMinutes: HaversineEtaEstimator.STEP_MINUTES,
};

/**
 * How long to wait before giving up and using arithmetic.
 *
 * 2.5s. This sits inside a server render of the customer's trip page and
 * inside a five-minute cron. A routing call that has not answered in two and a
 * half seconds is not going to improve the page enough to be worth the wait.
 */
const DEFAULT_TIMEOUT_MS = 2500;

export interface GoogleRoutesEtaEstimatorOptions {
  /** Server key. Restrict it to Routes + Places (New) and to a server, never a referrer. */
  apiKey: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** What answers when the API cannot. Defaults to the haversine estimator. */
  fallback?: HaversineEtaEstimator;
  /** Injected in tests so a fallback assertion does not print to the suite. */
  onFallback?: (reason: string, detail?: Record<string, unknown>) => void;
}

/** One element of the matrix response, as much of it as the field mask asks for. */
interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  /** Protobuf duration — a decimal number of seconds with a trailing "s". */
  duration?: string;
  condition?: string;
  status?: { code?: number; message?: string };
}

function waypoint({ lat, lng }: Coordinates) {
  return { waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } };
}

/** `"1234s"` → 1234. Anything else → null, which means "use the fallback". */
function parseDurationSeconds(duration: string | undefined): number | null {
  if (typeof duration !== "string" || !duration.endsWith("s")) return null;
  const seconds = Number(duration.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export class GoogleRoutesEtaEstimator implements EtaEstimator {
  readonly kind = "google-routes" as const;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #fallback: HaversineEtaEstimator;
  readonly #onFallback: (reason: string, detail?: Record<string, unknown>) => void;

  constructor(options: GoogleRoutesEtaEstimatorOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fallback = options.fallback ?? new HaversineEtaEstimator();
    this.#onFallback =
      options.onFallback ??
      ((reason, detail) => {
        // One line, never a throw. The estimate that follows is arithmetic.
        console.warn(`[eta:routes] falling back to haversine — ${reason}`, detail ?? {});
      });
  }

  async estimate(query: EtaQuery): Promise<EtaRange> {
    const [eta] = await this.estimateMany({ from: [query.from], to: query.to });
    return eta ?? this.#fallback.estimateSync(query);
  }

  async estimateMany(query: EtaBatchQuery): Promise<EtaRange[]> {
    const origins = [...query.from];
    if (origins.length === 0) return [];

    const seconds = await this.#durationsSeconds(origins, query.to);
    return origins.map((from, i) => {
      const s = seconds[i];
      return s === null || s === undefined
        ? this.#fallback.estimateSync({ from, to: query.to })
        : toEtaRange(s / 60, ROUTES_SHAPE);
    });
  }

  /**
   * Traffic-aware duration per origin, `null` where the API had no usable
   * answer for that one. A whole-call failure returns all-null, which the
   * caller turns into an all-haversine result — the failure is never visible
   * above the seam.
   */
  async #durationsSeconds(
    origins: readonly Coordinates[],
    to: Coordinates,
  ): Promise<(number | null)[]> {
    const empty = origins.map(() => null);

    let response: Response;
    try {
      response = await this.#fetch(ROUTE_MATRIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.#apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          origins: origins.map(waypoint),
          destinations: [waypoint(to)],
          travelMode: "DRIVE",
          // TRAFFIC_AWARE, not TRAFFIC_AWARE_OPTIMAL: the optimal tier is
          // materially slower and priced higher for an accuracy difference
          // that a 5-minute-rounded range cannot express.
          routingPreference: "TRAFFIC_AWARE",
          units: "METRIC",
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // Network, DNS, abort-on-timeout. Never rethrown.
      this.#onFallback("request failed", { error: String(error) });
      return empty;
    }

    if (!response.ok) {
      // 403 revoked/unrestricted key, 429 quota, 5xx theirs. All the same to
      // a caller: the arithmetic answers instead.
      this.#onFallback("non-2xx response", { status: response.status });
      return empty;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      this.#onFallback("unparseable response", { error: String(error) });
      return empty;
    }

    if (!Array.isArray(body)) {
      this.#onFallback("unexpected response shape");
      return empty;
    }

    const out: (number | null)[] = origins.map(() => null);
    for (const element of body as RouteMatrixElement[]) {
      const i = element.originIndex ?? 0;
      if (i < 0 || i >= out.length) continue;
      // `condition: ROUTE_NOT_FOUND` and a non-zero `status.code` are both
      // per-element failures — one unroutable origin must not cost the other
      // three their real estimate.
      if (element.condition !== undefined && element.condition !== "ROUTE_EXISTS")
        continue;
      if (element.status?.code !== undefined && element.status.code !== 0) continue;
      out[i] = parseDurationSeconds(element.duration);
    }

    const missing = out.filter((s) => s === null).length;
    if (missing > 0) {
      this.#onFallback("no usable duration for some origins", {
        missing,
        of: origins.length,
      });
    }
    return out;
  }
}
