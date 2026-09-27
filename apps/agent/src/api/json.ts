/**
 * What a value looks like after `JSON.stringify` → `JSON.parse`: every
 * `Date` becomes an ISO string, everything else keeps its shape. Handlers
 * build their responses through `toJson` so the compiler checks them
 * against the contract types (which declare dates as strings) instead of
 * trusting the serializer at the edge.
 */
export type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

export function toJson<T>(value: T): Jsonified<T> {
  return convert(value) as Jsonified<T>;
}

function convert(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(convert);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = convert(v);
    }
    return out;
  }
  return value;
}
