/**
 * Assertion helpers for database errors in integration tests.
 *
 * drizzle-orm (0.45+) wraps every failed query in a `DrizzleQueryError` whose
 * own message is `Failed query: …`; the Postgres error (message, SQLSTATE)
 * lives on `.cause`. Matching on the top-level message therefore misses what
 * the database actually said. These helpers walk the cause chain instead.
 */

/**
 * Walks the error cause chain and returns all messages joined, for assertions
 * against Postgres errors that drizzle-orm wraps in DrizzleQueryError.
 */
export function errorChainMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/** Postgres SQLSTATE from a wrapped or unwrapped error, if present. */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
