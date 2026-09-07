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
 *
 * THEY LOOK LIKE VANS BECAUSE THEY STAND IN FOR VANS. `LiveMap` draws a
 * `ghost` with the same pill, glyph and pulse a real driver gets — the earlier
 * grey dot read as a different kind of object and, in TD's words, "way more
 * fake". What separates them is the label: a masked initial, which is visibly
 * withheld rather than invented.
 */

/** How many to draw. Enough to read as "a few", too few to read as a count. */
const GHOST_COUNT = 3;

/**
 * How far out, in metres.
 *
 * "Not too near, not too far" — TD's framing, and both bounds do real work.
 * Too close and a placeholder overlaps the one pin that means something; too
 * far and it is not a driver who could plausibly be coming to this door. 600m
 * to 1.6km is a few minutes away at city speeds and comfortably inside the
 * frame the map opens at.
 */
const MIN_METRES = 600;
const MAX_METRES = 1_600;

/** Metres per degree of latitude. Close enough at city scale. */
const METRES_PER_DEGREE = 111_320;

/**
 * THEY DO NOT MOVE, and this replaced a drift that did.
 *
 * Each ghost used to wander up to 90m per tick, on the reasoning that a still
 * map reads as a broken one. In practice every pin re-seeded from the same
 * counter on the same interval, so all three set off at the same instant —
 * TD's report: "moving all together at the same time, same direction, so it is
 * so weird". Independent, plausible traffic would need per-pin phases,
 * headings and speeds, which is a simulation, and a simulation of vans that do
 * not exist is a lot of machinery pointed at the wrong thing.
 *
 * The pulse ring already says "something is happening" — it is the same ring a
 * real driver's pin carries — and the chip over the map says what. So the pins
 * hold still and blink, which is honest about being placeholders without
 * looking broken.
 */

/** Letters a masked initial can take. No I or O — they read as 1 and 0. */
const INITIALS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

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
    Math.abs(lngScale) < 1
      ? from.lng
      : from.lng + (metres * Math.sin(bearing)) / lngScale;
  return { lat, lng };
}

/**
 * Three anonymous pins around a pickup, stable for a given booking.
 *
 * @param seed   The booking id. Same booking, same pins, forever.
 * @param pickup The door — everything is placed relative to it.
 */
export function ghostDrivers(
  seed: string,
  pickup: MapPoint,
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
    const position = offset(pickup, metres, bearing);

    /*
     * A MASKED INITIAL, NOT A NAME AND NOT NOTHING.
     *
     * The first version passed `label: null` on the rule that a named ghost is
     * a fabricated person. That rule is right and this does not break it: an
     * initial followed by asterisks is visibly withheld information rather
     * than an identity — nobody reads "R****" as somebody's name. What it buys
     * is the pin looking like the thing it stands in for, which is the whole
     * point of the placeholder, and it makes the difference between "we are
     * still looking" and "here is your driver" legible at a glance.
     */
    const initial = INITIALS[Math.floor(base() * INITIALS.length)] ?? "K";

    ghosts.push({
      id: `ghost-${i}`,
      position,
      label: `${initial}${"*".repeat(4)}`,
      variant: "ghost",
    });
  }

  return ghosts;
}
