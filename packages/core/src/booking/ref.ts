/**
 * `KOO-XXXXX` — the booking reference a human can say out loud.
 *
 * Generated in core at booking creation, stored on `bookings.ref`, and used
 * for DISPLAY AND SUPPORT ONLY. Nothing authenticates or authorizes on it and
 * no public route looks a booking up by it: 32^5 is about 33.5 million, which
 * is workable for uniqueness (with the retry below) and hopeless as a secret.
 * The trip page stays addressed by UUID.
 *
 * No environment, no external dependency — `crypto.getRandomValues` is the
 * whole implementation.
 */

/**
 * Crockford base32. `I`, `L`, `O` and `U` are absent: the first three because
 * they collide with 1/1/0 in most typefaces and in handwriting, the last
 * because excluding it keeps the alphabet from spelling things at customers.
 * A ref read over the phone therefore transcribes back to the same row.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const BOOKING_REF_PREFIX = "KOO-";

/** Payload length. Five gives ~33.5M refs; the column is varchar(9). */
const PAYLOAD_LENGTH = 5;

/** What a well-formed ref looks like. Anchored — this is a full-string test. */
export const BOOKING_REF_PATTERN = /^KOO-[0-9A-HJKMNP-TV-Z]{5}$/;

/**
 * How many refs to try before giving up.
 *
 * This loop is LOAD-BEARING, not insurance. The birthday bound over a 33.5M
 * keyspace is unkind: by ~7,000 bookings there is a coin-flip chance that
 * SOME pair has collided, and by 10,000 it is better than three in four. A
 * generator without a retry would eventually refuse to create a booking.
 *
 * What stays negligible is the per-insert case, which is the one that
 * matters: at 10,000 existing rows a single attempt collides with
 * probability ~3e-4, so five consecutive collisions is ~2e-18. Five attempts
 * is therefore generous, and the bound means a genuinely exhausted keyspace
 * surfaces as an error rather than hanging.
 *
 * Widening the payload is the lever if `bookings` ever approaches that scale;
 * the column is `varchar(9)` and a sixth character would need a migration.
 */
export const BOOKING_REF_MAX_ATTEMPTS = 5;

/**
 * 256 is divisible by 32, so `byte % 32` is uniform over the alphabet — no
 * rejection sampling needed and no modulo bias.
 */
export function generateBookingRef(): string {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  crypto.getRandomValues(bytes);

  let payload = "";
  for (const byte of bytes) payload += ALPHABET[byte % ALPHABET.length];
  return BOOKING_REF_PREFIX + payload;
}

/** Postgres unique_violation (23505) on the `bookings_ref_key` index. */
export function isBookingRefConflict(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    const candidate = current as { code?: unknown; constraint_name?: unknown };
    if (candidate.code === "23505" && candidate.constraint_name === "bookings_ref_key") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class BookingRefExhaustedError extends Error {
  constructor(attempts: number) {
    super(
      `Could not mint a unique booking ref in ${attempts} attempts. The ` +
        `keyspace is exhausted or the unique index is misbehaving.`,
    );
    this.name = "BookingRefExhaustedError";
  }
}

/**
 * Runs `attempt` with a fresh ref, retrying on — and ONLY on — a
 * `bookings_ref_key` unique violation.
 *
 * The database is the arbiter rather than a `SELECT … WHERE ref = ?` before
 * the insert: that check races, and losing the race is exactly the case this
 * loop is for. Any other error propagates untouched on the first throw; a
 * retry loop that swallows unrelated failures is worse than no loop.
 */
export async function withBookingRef<T>(
  attempt: (ref: string) => Promise<T>,
  maxAttempts: number = BOOKING_REF_MAX_ATTEMPTS,
): Promise<T> {
  for (let tries = 1; tries <= maxAttempts; tries += 1) {
    try {
      return await attempt(generateBookingRef());
    } catch (error) {
      if (!isBookingRefConflict(error) || tries === maxAttempts) throw error;
    }
  }
  /* c8 ignore next -- unreachable: the loop either returns or throws above. */
  throw new BookingRefExhaustedError(maxAttempts);
}
