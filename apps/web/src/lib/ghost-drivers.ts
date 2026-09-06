import type { MapDriver, MapPoint } from "@koolee/ui";

/**
 * Placeholder pins, drawn while the shortlist is still being built.
 *
 * WHAT THIS IS FOR. Before this, a customer whose bags were sealed and who had
 * no shortlist yet got a text card — "We're assigning your driver" — and no
 * map at all. The most anxious moment in the whole product was also the only
 * one with nothing to look at, and the map reappearing later made it read as
 * though something had been broken and then fixed.
 *
 * WHAT IT IS NOT. These are not drivers, not a claim about how many drivers
 * exist, and not a count of anything. They are the visual equivalent of the
 * sentence beside them — "Finding drivers near you" — and every property below
 * is chosen to keep them from being read as more than that: no names, no ETAs,
 * no capacities, nothing tappable, and a muted colour that neither brand
 * accent uses. `LiveMap` renders `variant: "ghost"` as an inert `span`, so the
 * inertness is structural rather than a rule somebody has to remember.
 *
 * THE HONEST RISK, WRITTEN DOWN. A moving dot on a map reads as a vehicle, and
 * "drivers near you" beside it reads as availability. TD chose this
 * deliberately over a disclaimer and over a plain search radius; the
 * mitigations are that they are anonymous, inert, carry no count in words, and
 * vanish in the same render the first real candidate appears. If that trade is
 * ever revisited, this is the paragraph to revisit it against.
 *
 * DETERMINISTIC, WHICH IS NOT A DETAIL. The trip page is `force-dynamic` and
 * re-renders every few seconds while the customer waits. `Math.random()` here
 * would scatter the pins to new streets on every refresh — vans teleporting
 * around the neighbourhood, which reads as broken rather than as busy. Same
 * booking, same pins, every time.
 */

/** How many to draw. Enough to read as "a few", too few to read as a count. */
const GHOST_COUNT = 3;

/**
 * How far out, in metres.
 *
 * Near enough to be plausibly on their way, far enough that no ghost lands on
 * top of the pickup pin and gets mistaken for it. The lower bound is doing
 * real work: a placeholder overlapping the one pin that means something is
 * worse than no placeholder.
 */
const MIN_METRES = 400;
const MAX_METRES = 2_000;

/** Metres per degree of latitude. Close enough at city scale. */
const METRES_PER_DEGREE = 111_320;

/**
 * How far a ghost wanders per drift step, in metres.
 *
 * Small. They should look like vehicles idling in traffic, not like vehicles
 * crossing town — a placeholder that covers ground draws the eye to itself and
 * invites somebody to follow it, which is the last thing it should do.
 */
const DRIFT_METRES = 90;

/** FNV-1a. A stable, well-spread hash of the booking id — not a checksum. */
function hash(seed: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** mulberry32. Tiny, deterministic, and good enough to scatter three dots. */
function rng(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function offset(from: MapPoint, metres: number, bearing: number): MapPoint {
  const lat = from.lat + (metres * Math.cos(bearing)) / METRES_PER_DEGREE;
  const lngScale = METRES_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180);
  // At the poles `lngScale` collapses to zero and the division explodes. No
  // Koolee airport is within a thousand miles of one, but a NaN coordinate
  // takes the whole map down rather than one pin, so it is not left to luck.
  const lng =
    Math.abs(lngScale) < 1 ? from.lng : from.lng + (metres * Math.sin(bearing)) / lngScale;
  return { lat, lng };
}

/**
 * Three anonymous pins around a pickup, stable for a given booking.
 *
 * @param seed   The booking id. Same booking, same pins, forever.
 * @param pickup The door — everything is placed relative to it.
 * @param step   Drift counter. Hold it at 0 for a still map; increment it on a
 *               timer for the idling motion. Each step is a fresh deterministic
 *               nudge, so a given (seed, step) always produces the same frame
 *               and a re-render mid-drift does not jump.
 */
export function ghostDrivers(
  seed: string,
  pickup: MapPoint,
  step = 0,
  count = GHOST_COUNT,
): MapDriver[] {
  const base = rng(hash(seed));
  const ghosts: MapDriver[] = [];

  for (let i = 0; i < count; i += 1) {
    /*
     * Spread across the compass rather than left to chance: three random
     * bearings land in the same quadrant often enough to look like a mistake.
     * Each gets its own third of the circle plus a random position within it.
     */
    const sector = (i / count) * Math.PI * 2;
    const bearing = sector + base() * ((Math.PI * 2) / count);
    const metres = MIN_METRES + base() * (MAX_METRES - MIN_METRES);
    const home = offset(pickup, metres, bearing);

    // The drift is seeded from the STEP as well, so it is reproducible rather
    // than accumulated — no rounding walk, and no dependence on how many
    // renders happened to occur.
    const wander = rng(hash(`${seed}:${i}:${step}`));
    const position = step === 0 ? home : offset(home, wander() * DRIFT_METRES, wander() * Math.PI * 2);

    ghosts.push({
      id: `ghost-${i}`,
      position,
      // NO LABEL, EVER. A named ghost is a fabricated person.
      label: null,
      variant: "ghost",
    });
  }

  return ghosts;
}
