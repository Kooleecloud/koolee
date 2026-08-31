import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import {
  agentZones,
  bookings,
  custodyEvents,
  driverPositions,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Booking,
  type Database,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { emitDriverPoolEmpty, emitDriverSelected } from "../events/booking-events";
import {
  ConflictError,
  InvalidInputError,
  NotAuthorizedError,
  NotFoundError,
} from "../errors";
import { assertActionable, assignmentGate } from "./actionability";
import { touchBookingSignals } from "./booking-signals";
import { toCoordinates, type Coordinates } from "../geo/coordinates";
import type { EtaRange } from "../geo/eta";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import { bookingPickupAddress } from "./pickup-address";
import { OPEN_TASK_STATUSES } from "./tasks";

/**
 * Customer-facing driver selection.
 *
 * The customer picks their driver. Not dispatch, not an algorithm — which is
 * why this reads like a shortlist rather than an optimiser: four candidates,
 * ordered so the emptiest truck is first, each with an honest ETA range.
 *
 * The eligibility rule, in order, and each clause's reason:
 *
 *  1. ON SHIFT, and cleared to drive, and the truck is active. A shift is the
 *     "I am out right now" fact; without it a driver is a name in a table.
 *  2. COVERS THE PICKUP ZIP. Shared with agents through `agent_zones` — the
 *     table is not renamed (198 live rows and an admin CRUD behind it) and
 *     the role filter moves to READ TIME instead. See the note on the zone
 *     subquery below.
 *  3. HAS ROOM: `truck.bag_capacity − bags already committed to the shift`
 *     must be at least this booking's bag count. Bags, never task count — a
 *     12-bag van must not accept twelve four-bag runs.
 *
 * Then sorted by current load ascending, and capped at four. Four because a
 * customer choosing between four people is choosing; a customer choosing
 * between fifteen is doing dispatch's job.
 *
 * WIDENING. If nothing in-zone qualifies, the same query runs again without
 * clause 2 and every result is marked `outOfZone` so the UI can frame the
 * longer drive honestly. If that is still empty the caller gets an empty list
 * and owns the message — see the customer trip page, which also raises an ops
 * alert rather than leaving the customer looking at nothing.
 */

/**
 * HOW MANY BAGS A VAN CAN STILL TAKE FROM A BOOKING.
 *
 *     bag_capacity − reserved_spaces − bags already on board
 *
 * `reserved_spaces` is the middle term, and until slice F4 it was not there.
 * The column existed, the admin form edited it, and it was labelled "not yet
 * enforced" — every capacity check in this file read `bag_capacity` raw. An
 * operator holding two spaces back for a wheelchair, a fragile case or a
 * return leg had a van that kept accepting bookings into them.
 *
 * ONE FUNCTION, FOUR READERS, and that is the point of extracting it. The
 * shortlist filter, the candidate it renders, the transactional recheck under
 * the advisory lock and the console's reassign picker each computed
 * `bagCapacity - bagsOnBoard` independently, so a reserve honoured in three
 * of them and forgotten in the fourth would have been a race the tests could
 * not see.
 *
 * CLAMPED AT ZERO. `reserved_spaces < bag_capacity` is enforced on write
 * (`createTruck` / `updateTruck`), so a negative is unreachable for a truck
 * entered today — but a row predating that guard must render "0 spaces left",
 * not "-2".
 */
export function bookableSpaces(
  truck: { bagCapacity: number; reservedSpaces: number },
  bagsOnBoard: number,
): number {
  return Math.max(0, truck.bagCapacity - truck.reservedSpaces - bagsOnBoard);
}

/** Statuses from which a customer may choose (or re-choose) a driver. */
export const DRIVER_SELECTABLE_STATUSES = [
  "verified_sealed",
  "awaiting_pickup",
] as const satisfies readonly Booking["status"][];

/** How many drivers a customer is asked to choose between. */
export const DRIVER_SHORTLIST_SIZE = 4;

export interface DriverCandidate {
  /** The assignment target. Selection is by SHIFT, never by person. */
  shiftId: string;
  staffUserId: string;
  /** First name only — a customer needs to greet somebody, not identify them. */
  givenName: string | null;
  /** Key in the PRIVATE `avatars` bucket, or null. Signed by the caller. */
  avatarStoragePath: string | null;
  truckName: string;
  bagCapacity: number;
  /** Held back from booking capacity by ops. Usually 0. */
  reservedSpaces: number;
  /** Bags already committed to this shift. */
  bagsOnBoard: number;
  /** `bookableSpaces(truck, bagsOnBoard)`. Always ≥ the booking's bag count. */
  availableCapacity: number;
  /**
   * True when this driver does not cover the pickup ZIP and only appears
   * because nobody who does was available. The UI must say so.
   */
  outOfZone: boolean;
  /**
   * Null when the driver has never pinged a position — a real state, not an
   * error. Render `formatEtaMinutes(null)`, never a guess.
   */
  eta: EtaRange | null;
  /**
   * The driver's last reported position, for the map.
   *
   * WHAT THIS DISCLOSES AND TO WHOM. A shortlist is at most four drivers who
   * are on shift, have room for these bags, and (all but the widened case)
   * cover this pickup's ZIP — and it is only ever built for a customer whose
   * own bags are sealed and waiting. So this is the live position of somebody
   * about to drive to that customer's door, shown to that customer, which is
   * the same bargain every ride-hail app strikes and the reason the pool is
   * filtered before it is drawn.
   *
   * It is a 45-second-old foreground ping, not a track: `driver_positions`
   * holds ONE mutable row per driver and keeps no history (schema/ops.ts).
   * Null the moment a phone goes into a pocket, which the map renders as an
   * absent pin rather than a stale one.
   */
  position: Coordinates | null;
}

interface EligibleRow {
  shiftId: string;
  staffUserId: string;
  fullName: string | null;
  avatarStoragePath: string | null;
  truckName: string;
  bagCapacity: number;
  reservedSpaces: number;
  bagsOnBoard: number;
  inZone: boolean;
  driverLat: number | null;
  driverLng: number | null;
}

const givenNameOf = (fullName: string | null): string | null =>
  fullName?.trim().split(/\s+/)[0] ?? null;

/**
 * Every driver currently on shift, with their load, their zone match and
 * their last position — one query, no filtering yet.
 *
 * The zone check is an `EXISTS` rather than a join so a driver covering the
 * ZIP twice cannot appear twice, and so the widening fallback is a filter in
 * memory rather than a second round trip.
 */
async function eligibleShifts(db: Database, zip: string): Promise<EligibleRow[]> {
  const bagsOnBoard = sql<number>`(
    select coalesce(sum(b.bag_count), 0)::int
      from ${pickupTasks} pt
      join ${bookings} b on b.id = pt.booking_id
     where pt.driver_shift_id = ${driverShifts.id}
       and pt.status in ('pending', 'assigned', 'in_progress')
  )`;

  return db
    .select({
      shiftId: driverShifts.id,
      staffUserId: driverShifts.staffUserId,
      fullName: users.fullName,
      avatarStoragePath: users.avatarStoragePath,
      truckName: trucks.name,
      bagCapacity: trucks.bagCapacity,
      reservedSpaces: trucks.reservedSpaces,
      bagsOnBoard,
      // `agent_zones` is shared with agents and NOT renamed: 198 live rows, an
      // admin CRUD, and an FK to `users` that already fits a driver. What
      // makes a row "an agent's" is only the column name plus the role filter
      // its other reader applies — so the discriminator lives at read time
      // here too, and this one filters on `can_drive` instead of `role`.
      inZone: sql<boolean>`${exists(
        db
          .select({ one: sql`1` })
          .from(agentZones)
          .where(
            and(
              eq(agentZones.agentUserId, driverShifts.staffUserId),
              eq(agentZones.zip, zip),
            ),
          ),
      )}`,
      driverLat: driverPositions.lat,
      driverLng: driverPositions.lng,
    })
    .from(driverShifts)
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .innerJoin(staffMembers, eq(staffMembers.userId, driverShifts.staffUserId))
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .leftJoin(driverPositions, eq(driverPositions.staffUserId, driverShifts.staffUserId))
    .where(
      and(
        isNull(driverShifts.endedAt),
        eq(trucks.active, true),
        eq(staffMembers.active, true),
        eq(staffMembers.canDrive, true),
      ),
    )
    .orderBy(asc(driverShifts.id));
}

interface SelectionContext {
  booking: Booking;
  pickup: { zip: string; coords: Coordinates | null };
}

async function loadSelectionContext(
  db: Database,
  bookingId: string,
): Promise<SelectionContext> {
  // No join: the doorstep is on the booking since 0033, so the zone a booking
  // dispatches into cannot change when somebody edits their saved address.
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) throw new NotFoundError("Booking", bookingId);

  const pickupAddress = bookingPickupAddress(booking);
  return {
    booking,
    pickup: {
      zip: pickupAddress.zip.slice(0, 5),
      coords: toCoordinates(pickupAddress.lat, pickupAddress.lng),
    },
  };
}

function assertSelectable(booking: Booking): void {
  if (!(DRIVER_SELECTABLE_STATUSES as readonly string[]).includes(booking.status)) {
    throw new ConflictError(
      "driver",
      `Booking ${booking.ref} is ${booking.status} — a driver is chosen once the bags are sealed.`,
    );
  }
}

export interface ListCandidateDriversInput {
  bookingId: string;
}

export async function listCandidateDrivers(
  config: CoreConfig,
  input: ListCandidateDriversInput,
): Promise<DriverCandidate[]> {
  const { db } = config;
  const { booking, pickup } = await loadSelectionContext(db, input.bookingId);
  assertSelectable(booking);
  // A shortlist is an offer. Offering one on a booking whose bag drop has
  // closed asks the customer to choose a driver who cannot make the flight.
  await assertActionable(config, booking, "selectDriver");

  const rows = await eligibleShifts(db, pickup.zip);

  const withRoom = rows.filter(
    (r) => bookableSpaces(r, r.bagsOnBoard) >= booking.bagCount,
  );

  const inZone = withRoom.filter((r) => r.inZone);
  // Widen only when the first pass is EMPTY, never to pad a short list: a
  // customer offered one in-zone driver and three from across the river would
  // reasonably read that as four equivalent choices.
  const pool = inZone.length > 0 ? inZone : withRoom;
  const outOfZone = inZone.length === 0;

  const shortlist = pool
    .sort((a, b) => a.bagsOnBoard - b.bagsOnBoard || a.shiftId.localeCompare(b.shiftId))
    .slice(0, DRIVER_SHORTLIST_SIZE);

  const etas = await shortlistEtas(config, shortlist, pickup.coords);

  return shortlist.map((row, i) => toCandidate(row, outOfZone, etas[i] ?? null));
}

/**
 * The best of a shortlist: nearest by ETA, tie-broken by the emptiest van.
 *
 * ONE TAP INSTEAD OF FOUR CARDS. Most customers have no basis for preferring
 * one stranger's van over another and are being asked to anyway — the
 * shortlist is a real choice for the person who wants it and a chore for
 * everybody else. This is the shortcut, and it must be a shortcut rather than
 * a different system: it picks FROM the same shortlist, by a rule the customer
 * could have applied themselves looking at the same four cards.
 *
 * NEAREST BY ETA, and specifically by `minMinutes`. The seam returns a RANGE
 * because an estimate built from ZIP centroids and an average speed is not
 * accurate to the minute; comparing the optimistic ends of two ranges is the
 * same comparison a person makes reading "about 15 min" against "about 25
 * min", which is the whole point of matching what the cards show.
 *
 * A DRIVER WITH NO ETA IS NEVER "BEST". `eta` is null when they have never
 * pinged a position — a real state, not an error — and there is no honest way
 * to rank an unknown against a number. They stay perfectly choosable by hand;
 * they are simply not what an automatic choice reaches for. If NOBODY has an
 * ETA the tie-break decides on its own, which is the right answer: with no
 * distance information, the emptiest van is the only thing left that means
 * anything.
 *
 * TIE-BREAK ON BAG LOAD, then shift id. Two drivers a minute apart are the
 * same answer to "when", so the second question is which van has more room —
 * the same ordering `listCandidateDrivers` already sorts the shortlist by, so
 * a tie resolves to the card nearest the top. The shift id last makes it
 * deterministic: an unstable "best" would send two identical requests to two
 * different drivers.
 *
 * PURE, and takes candidates rather than a booking id, because the rule is a
 * claim about a list and ought to be provable without a database. The caller
 * hands the result to the ORDINARY `selectDriver`, so the transaction, the
 * advisory lock and the capacity recheck are identical to a manual pick —
 * there is exactly one way to be assigned a driver.
 */
export function bestCandidate(
  candidates: readonly DriverCandidate[],
): DriverCandidate | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const aEta = a.eta?.minMinutes ?? null;
    const bEta = b.eta?.minMinutes ?? null;
    if (aEta !== bEta) {
      if (aEta === null) return 1;
      if (bEta === null) return -1;
      return aEta - bEta;
    }
    return a.bagsOnBoard - b.bagsOnBoard || a.shiftId.localeCompare(b.shiftId);
  });

  return ranked[0] ?? null;
}

/**
 * One estimator call for the whole shortlist, not one per driver.
 *
 * `estimate` became async in Tier 5 so a routing provider could sit behind the
 * seam. The obvious translation — `await` inside the `.map` this used to be —
 * would have made a page render four SERIAL network round-trips for a number
 * that is explicitly not load-bearing. `estimateMany` is the batch shape, and
 * a route-matrix API answers all four in one request.
 *
 * Drivers with no position yet are left out of the call and get `null`, which
 * the card renders as "ETA on the way".
 */
async function shortlistEtas(
  config: CoreConfig,
  rows: readonly EligibleRow[],
  pickupCoords: Coordinates | null,
): Promise<(EtaRange | null)[]> {
  const origins = rows.map((r) => toCoordinates(r.driverLat, r.driverLng));
  if (pickupCoords === null) return origins.map(() => null);

  const known = origins.filter((c): c is Coordinates => c !== null);
  if (known.length === 0) return origins.map(() => null);

  const estimates = await config.etaEstimator.estimateMany({
    from: known,
    to: pickupCoords,
  });

  // Re-align: `estimates` is indexed against the drivers that HAD a position.
  let next = 0;
  return origins.map((coords) => (coords === null ? null : (estimates[next++] ?? null)));
}

function toCandidate(
  row: EligibleRow,
  outOfZone: boolean,
  eta: EtaRange | null,
): DriverCandidate {
  return {
    shiftId: row.shiftId,
    staffUserId: row.staffUserId,
    givenName: givenNameOf(row.fullName),
    avatarStoragePath: row.avatarStoragePath,
    truckName: row.truckName,
    bagCapacity: row.bagCapacity,
    reservedSpaces: row.reservedSpaces,
    bagsOnBoard: row.bagsOnBoard,
    availableCapacity: bookableSpaces(row, row.bagsOnBoard),
    outOfZone,
    eta,
    position: toCoordinates(row.driverLat, row.driverLng),
  };
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export interface SelectDriverInput {
  bookingId: string;
  /** The customer's own user id. Ownership is checked, never assumed. */
  userId: string;
  shiftId: string;
}

export interface SelectDriverResult {
  candidate: DriverCandidate;
  /** The shift this pickup was taken from, when the customer chose again. */
  releasedShiftId: string | null;
}

/**
 * Assigns the booking's pickup task to a shift.
 *
 * CONCURRENCY. Everything inside one transaction, behind ONE
 * `pg_advisory_xact_lock` taken on the chosen SHIFT. The lock is what makes
 * the capacity recount meaningful: two customers reading the same "3 spaces
 * left" both pass any check written outside a lock, and the truck leaves with
 * eight bags in a six-bag van.
 *
 * LOCK ORDER — there isn't one, and that is deliberate. `otp-throttle.ts`
 * takes TWO advisory locks and therefore has to document a fixed order (user,
 * then destination) to stay deadlock-free. This function takes EXACTLY ONE,
 * ever, so no ordering rule is needed and no deadlock is possible. The
 * tempting second lock would be the shift being released when a customer
 * re-chooses — it is not taken, because releasing only ever ADDS capacity to
 * the old shift, and no invariant is defended by an upper bound going down.
 * If a future change ever needs both, take them in ascending shift-id order
 * and write that down here, the way otp-throttle does.
 *
 * Why an advisory lock rather than the other two house patterns: a unique
 * index cannot express "sum of bag counts ≤ capacity", and a compare-and-swap
 * needs a single column to swap on. `FOR UPDATE` does not appear anywhere in
 * this codebase and this is not the place to introduce it — the row being
 * defended (`driver_shifts`) is not the row being written (`pickup_tasks`).
 *
 * RE-RUNNABLE until the driver sets off. Re-selecting moves the one pickup
 * task row, which releases the previous shift by construction — there is no
 * second row to clean up. Once travel has started (`started_at` set) the bags
 * are somebody's responsibility and the choice is closed.
 */
export async function selectDriver(
  config: CoreConfig,
  input: SelectDriverInput,
): Promise<SelectDriverResult> {
  const { db } = config;
  const { booking, pickup } = await loadSelectionContext(db, input.bookingId);

  if (booking.userId !== input.userId) {
    throw new NotAuthorizedError("That booking belongs to another account.");
  }
  assertSelectable(booking);
  // Checked here as well as in `listCandidateDrivers`, not instead of it: a
  // shortlist rendered before the cutoff is still on screen after it, and the
  // submit is a reachable POST whatever the page shows.
  await assertActionable(config, booking, "selectDriver", {
    userId: input.userId,
    role: "customer",
  });

  // BEFORE the transaction, deliberately. The ETA is a snapshot for the
  // custody event's metadata — a record of what the customer was told — and
  // nothing depends on it. Since Tier 5 the estimator may be a routing API,
  // and a network round-trip inside `db.transaction` would hold the shift's
  // advisory lock open for its duration, serialising every other customer
  // choosing that same driver behind a third party's latency. The position it
  // reads is at most one GPS ping (20–45s) older than the one re-read under the
  // lock; a null either way renders as "ETA on the way".
  const eta = await snapshotDriverEta(config, input.shiftId, pickup.coords);

  const result = await db.transaction(async (tx) => {
    // Serialises every selection targeting THIS shift. `hashtextextended` is
    // the same hashing the OTP throttle uses — advisory locks take bigints,
    // and a uuid has to become one somehow.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.shiftId}, 0))`,
    );

    const task = await tx.query.pickupTasks.findFirst({
      where: eq(pickupTasks.bookingId, booking.id),
    });
    if (!task) {
      throw new NotFoundError("Pickup task for booking", booking.id);
    }
    if (
      task.startedAt !== null ||
      !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)
    ) {
      throw new ConflictError(
        "driver",
        "Your driver is already on the way — the choice is closed.",
      );
    }

    // Re-read under the lock. Everything the shortlist checked is checked
    // again, because between rendering and clicking a driver can clock off,
    // a truck can be taken out of service, and three other customers can
    // fill the van.
    const [row] = await tx
      .select({
        shift: driverShifts,
        truckName: trucks.name,
        bagCapacity: trucks.bagCapacity,
        // Re-read under the lock with everything else: ops can raise a
        // reserve between the shortlist rendering and the customer clicking.
        reservedSpaces: trucks.reservedSpaces,
        fullName: users.fullName,
        avatarStoragePath: users.avatarStoragePath,
        canDrive: staffMembers.canDrive,
        staffActive: staffMembers.active,
        driverLat: driverPositions.lat,
        driverLng: driverPositions.lng,
      })
      .from(driverShifts)
      .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
      .innerJoin(staffMembers, eq(staffMembers.userId, driverShifts.staffUserId))
      .innerJoin(users, eq(users.id, driverShifts.staffUserId))
      .leftJoin(
        driverPositions,
        eq(driverPositions.staffUserId, driverShifts.staffUserId),
      )
      .where(and(eq(driverShifts.id, input.shiftId), isNull(driverShifts.endedAt)))
      .limit(1);

    if (!row || !row.staffActive || !row.canDrive || !row.shift) {
      throw new ConflictError(
        "driver",
        "That driver just finished their shift. Pick another and we will get straight on it.",
      );
    }

    const [load] = await tx
      .select({ bags: sql<number>`coalesce(sum(${bookings.bagCount}), 0)::int` })
      .from(pickupTasks)
      .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
      .where(
        and(
          eq(pickupTasks.driverShiftId, input.shiftId),
          inArray(pickupTasks.status, [...OPEN_TASK_STATUSES]),
          // A re-selection onto the SAME shift must not count itself, or the
          // second click looks like a capacity failure.
          sql`${pickupTasks.bookingId} <> ${booking.id}`,
        ),
      );

    const bagsOnBoard = load?.bags ?? 0;
    const availableCapacity = bookableSpaces(row, bagsOnBoard);
    if (availableCapacity < booking.bagCount) {
      throw new ConflictError(
        "driver",
        `${row.truckName} filled up while you were choosing — ${availableCapacity} space${availableCapacity === 1 ? "" : "s"} left and you have ${booking.bagCount} bags. Pick another driver.`,
      );
    }

    const releasedShiftId =
      task.driverShiftId && task.driverShiftId !== input.shiftId
        ? task.driverShiftId
        : null;

    await tx
      .update(pickupTasks)
      .set({
        driverShiftId: input.shiftId,
        // Written in the same statement, never separately — the two columns
        // must agree (see `schema/tasks.ts`).
        assigneeUserId: row.shift.staffUserId,
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(pickupTasks.id, task.id));

    if (releasedShiftId) {
      await tx.insert(custodyEvents).values({
        bookingId: booking.id,
        actorUserId: input.userId,
        actorRole: "customer",
        eventType: PICKUP_EVENT_TYPES.driver_released,
        metadata: { shiftId: releasedShiftId, replacedByShiftId: input.shiftId },
      });
    }

    const [selectedEvent] = await tx
      .insert(custodyEvents)
      .values({
        bookingId: booking.id,
        actorUserId: input.userId,
        actorRole: "customer",
        eventType: PICKUP_EVENT_TYPES.driver_selected,
        metadata: {
          shiftId: input.shiftId,
          truckName: row.truckName,
          driverUserId: row.shift.staffUserId,
          bagCount: booking.bagCount,
          etaMinMinutes: eta?.minMinutes ?? null,
          etaMaxMinutes: eta?.maxMinutes ?? null,
        },
      })
      .returning({ id: custodyEvents.id });

    const candidate: DriverCandidate = {
      shiftId: input.shiftId,
      staffUserId: row.shift.staffUserId,
      givenName: givenNameOf(row.fullName),
      avatarStoragePath: row.avatarStoragePath,
      truckName: row.truckName,
      bagCapacity: row.bagCapacity,
      reservedSpaces: row.reservedSpaces,
      bagsOnBoard: bagsOnBoard + booking.bagCount,
      availableCapacity: availableCapacity - booking.bagCount,
      outOfZone: false,
      eta,
      // Re-read under the lock along with everything else on this row.
      position: toCoordinates(row.driverLat, row.driverLng),
    };

    return { candidate, releasedShiftId, custodyEventId: selectedEvent?.id ?? null };
  });

  // AFTER the commit, and never inside the transaction: the pickup is assigned
  // whether or not an email ever sends, and emission never throws.
  await emitDriverSelected(config.emitter, {
    bookingId: booking.id,
    shiftId: input.shiftId,
    driverUserId: result.candidate.staffUserId,
    dedupeKey: result.custodyEventId ?? `${input.shiftId}:${Date.now()}`,
  });

  return { candidate: result.candidate, releasedShiftId: result.releasedShiftId };
}

/**
 * The ETA to write into the `pickup.driver_selected` custody event.
 *
 * Its own small read of `driver_positions` rather than reusing the row the
 * transaction re-reads under the lock — see the call site for why the network
 * call must not be inside the transaction. Null (no shift, no position, no
 * pickup coordinate) is a perfectly ordinary answer.
 */
async function snapshotDriverEta(
  config: CoreConfig,
  shiftId: string,
  pickupCoords: Coordinates | null,
): Promise<EtaRange | null> {
  if (pickupCoords === null) return null;

  const [row] = await config.db
    .select({ lat: driverPositions.lat, lng: driverPositions.lng })
    .from(driverShifts)
    .innerJoin(driverPositions, eq(driverPositions.staffUserId, driverShifts.staffUserId))
    .where(eq(driverShifts.id, shiftId))
    .limit(1);

  const from = toCoordinates(row?.lat, row?.lng);
  if (from === null) return null;

  return config.etaEstimator.estimate({ from, to: pickupCoords });
}

/**
 * Records that a sealed booking was shown to a customer with nothing to offer.
 *
 * Called from the render that found the empty list — see `emitDriverPoolEmpty`
 * for why a render may do this safely (the hour-bucketed event id IS the
 * throttle). Never throws: a page that cannot page ops must still render.
 */
export async function reportEmptyDriverPool(
  config: CoreConfig,
  input: { bookingId: string },
): Promise<void> {
  try {
    const { booking, pickup } = await loadSelectionContext(config.db, input.bookingId);
    await emitDriverPoolEmpty(config.emitter, {
      bookingId: booking.id,
      zip: pickup.zip,
      bagCount: booking.bagCount,
      now: config.clock.now(),
    });
  } catch (error) {
    console.error(
      `[driver-selection] pool-empty report failed for ${input.bookingId}`,
      error,
    );
  }
}

/** The driver a booking currently has, for the trip page and the console. */
/**
 * How old a GPS fix may be and still count as "where the driver is".
 *
 * `driver_positions` holds ONE mutable row per driver with no history, and the
 * agent app pings only in the FOREGROUND. A phone in a pocket stops reporting,
 * and the row keeps the last fix indefinitely — including one from a JOB THE
 * DRIVER FINISHED YESTERDAY. Rendering that on a map draws a van somewhere it
 * is not, with exactly the confidence of a live one.
 *
 * NINETY SECONDS, which is roughly four missed pings at the twenty-second
 * cadence the agent app uses while a driver is en route to a door
 * (`PING_INTERVAL_MS`, `components/shift/gps-pinger.tsx`). Long enough to
 * survive a tunnel, a lock screen or a dropped request; short enough that
 * nobody watches a frozen pin and believes it.
 *
 * It was three minutes, sized against a flat 45-second ping. That is a long
 * time to be wrong about a moving vehicle: a van in city traffic covers the
 * better part of a kilometre in it, so the pin could sit a dozen blocks from
 * the truck while looking perfectly current. The rule of thumb is ~4× the
 * ACTIVE ping interval, and the active interval is now 20s.
 *
 * Past this, `positionIsFresh` is false and every surface falls back to what
 * it said before there was a map: a distance, and "Position updating".
 */
export const POSITION_FRESH_MS = 90_000;

export interface SelectedDriver {
  shiftId: string;
  staffUserId: string;
  givenName: string | null;
  avatarStoragePath: string | null;
  truckName: string;
  taskStatus: string;
  travelStartedAt: Date | null;
  /** Latest position, or null when the driver has not pinged. */
  position: Coordinates | null;
  positionRecordedAt: Date | null;
  /**
   * Whether `position` is recent enough to present as current — see
   * `POSITION_FRESH_MS`. False with a non-null `position` is the case that
   * matters: we know where they were, and it is too old to draw.
   */
  positionIsFresh: boolean;
}

export async function getSelectedDriver(
  db: Database,
  bookingId: string,
  /**
   * Explicit, and defaulted — the same shape `listCustomerTrips` uses. Only
   * `positionIsFresh` reads it, and a test that wants a stale fix should be
   * able to say so without waiting out the freshness window.
   */
  now: Date = new Date(),
): Promise<SelectedDriver | null> {
  const [row] = await db
    .select({
      shiftId: driverShifts.id,
      staffUserId: driverShifts.staffUserId,
      fullName: users.fullName,
      avatarStoragePath: users.avatarStoragePath,
      truckName: trucks.name,
      taskStatus: pickupTasks.status,
      travelStartedAt: pickupTasks.startedAt,
      lat: driverPositions.lat,
      lng: driverPositions.lng,
      recordedAt: driverPositions.recordedAt,
    })
    .from(pickupTasks)
    .innerJoin(driverShifts, eq(driverShifts.id, pickupTasks.driverShiftId))
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .leftJoin(driverPositions, eq(driverPositions.staffUserId, driverShifts.staffUserId))
    .where(eq(pickupTasks.bookingId, bookingId))
    .limit(1);

  if (!row) return null;
  return {
    shiftId: row.shiftId,
    staffUserId: row.staffUserId,
    givenName: givenNameOf(row.fullName),
    avatarStoragePath: row.avatarStoragePath,
    truckName: row.truckName,
    taskStatus: row.taskStatus,
    travelStartedAt: row.travelStartedAt,
    position: toCoordinates(row.lat, row.lng),
    positionRecordedAt: row.recordedAt,
    positionIsFresh:
      row.recordedAt !== null &&
      now.getTime() - row.recordedAt.getTime() <= POSITION_FRESH_MS,
  };
}

/**
 * Upsert of a driver's latest position. Called from the agent app's GPS ping.
 *
 * NOT a custody event, and not a track — one mutable row per driver, see
 * `schema/ops.ts`. Rejects a position from somebody who is not on shift, so a
 * stale tab cannot keep reporting after clock-off.
 */
export async function recordDriverPosition(
  config: CoreConfig,
  input: { staffUserId: string; lat: number; lng: number; recordedAt?: Date },
): Promise<void> {
  const { db } = config;

  if (
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng) ||
    Math.abs(input.lat) > 90 ||
    Math.abs(input.lng) > 180
  ) {
    throw new InvalidInputError("position", "That is not a position on this planet.");
  }

  const [shift] = await db
    .select({ id: driverShifts.id })
    .from(driverShifts)
    .where(
      and(eq(driverShifts.staffUserId, input.staffUserId), isNull(driverShifts.endedAt)),
    )
    .limit(1);
  if (!shift) {
    throw new NotAuthorizedError("Not on shift — positions are only recorded on shift.");
  }

  const recordedAt = input.recordedAt ?? config.clock.now();
  await db
    .insert(driverPositions)
    .values({
      staffUserId: input.staffUserId,
      lat: input.lat,
      lng: input.lng,
      recordedAt,
    })
    .onConflictDoUpdate({
      target: driverPositions.staffUserId,
      set: { lat: input.lat, lng: input.lng, recordedAt },
    });

  /*
   * Ring the realtime doorbell for the bookings this driver is actually
   * carrying.
   *
   * This is the ONE writer that has to signal explicitly. Every other change
   * worth watching appends a custody event, and 0030's trigger covers those by
   * construction — but a position is deliberately NOT evidence and appends
   * nothing, and "how close is my driver" is precisely the number a customer
   * sits and watches. Without this the driver card would move only on the
   * polling fallback.
   *
   * Scoped to shifts that are RUNNING (`started_at` set, not yet done), so a
   * ping does not wake pages for bookings whose bags are still on a doorstep.
   * Never throws: `touchBookingSignals` swallows, and a lost ping is one
   * missed frame of an estimate that is already a range.
   */
  const carrying = await db
    .select({ bookingId: pickupTasks.bookingId })
    .from(pickupTasks)
    .where(
      and(
        eq(pickupTasks.driverShiftId, shift.id),
        inArray(pickupTasks.status, ["assigned", "in_progress"]),
      ),
    );
  await touchBookingSignals(
    db,
    carrying.map((row) => row.bookingId),
    input.staffUserId,
  );
}

/* ------------------------------------------------------------------ */
/* Admin reassignment                                                  */
/* ------------------------------------------------------------------ */

export interface AdminReassignPickupInput {
  bookingId: string;
  /** The shift to move it to. */
  shiftId: string;
  adminUserId: string;
  /**
   * Place it even when the driver does not cover the ZIP or the truck is over
   * capacity.
   *
   * Ops override, not a shortcut: the flag is recorded on the custody event
   * with the exact reason it was needed, so a van that arrived overloaded is
   * traceable to the decision rather than to a bug. Without it the same rules
   * a customer's own choice obeys apply here too.
   */
  override?: boolean;
}

export interface AdminReassignPickupResult {
  shiftId: string;
  releasedShiftId: string | null;
  /** Which rule the override waived, when one was needed. */
  overrode: ("zone" | "capacity")[];
}

/**
 * Moves a pickup to a different shift, from the console.
 *
 * Same lock, same recount, same one-lock rule as `selectDriver` — the two are
 * genuinely the same operation with a different actor and a different
 * authority, so they must not drift into two different concurrency stories.
 * What differs:
 *
 *  - no customer-ownership check (an admin is not the booking's owner);
 *  - the started-travel guard is RELAXED. A customer may not re-choose once a
 *    driver has set off; ops may, because "the van broke down halfway" is
 *    exactly when a reassignment is needed. A pickup already delivered is
 *    still refused — the bags are the airline's.
 *  - the zone and capacity rules can be waived with `override`, and each
 *    waiver is named in the custody event.
 *
 * Admin-only. Enforced at the action layer, like every other admin write.
 */
export async function adminReassignPickup(
  config: CoreConfig,
  input: AdminReassignPickupInput,
): Promise<AdminReassignPickupResult> {
  const { db } = config;
  const { booking, pickup } = await loadSelectionContext(db, input.bookingId);

  // The shared gate: complete, cancelled, or already with the airline. It
  // replaces a two-status array here that never mentioned `cancelled`.
  const reassignGate = assignmentGate("pickup", booking, false);
  if (!reassignGate.allowed) throw new ConflictError("driver", reassignGate.reason!);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.shiftId}, 0))`,
    );

    const task = await tx.query.pickupTasks.findFirst({
      where: eq(pickupTasks.bookingId, booking.id),
    });
    if (!task) throw new NotFoundError("Pickup task for booking", booking.id);

    const [row] = await tx
      .select({
        shift: driverShifts,
        truckName: trucks.name,
        bagCapacity: trucks.bagCapacity,
        reservedSpaces: trucks.reservedSpaces,
        canDrive: staffMembers.canDrive,
        staffActive: staffMembers.active,
      })
      .from(driverShifts)
      .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
      .innerJoin(staffMembers, eq(staffMembers.userId, driverShifts.staffUserId))
      .where(and(eq(driverShifts.id, input.shiftId), isNull(driverShifts.endedAt)))
      .limit(1);

    if (!row || !row.staffActive || !row.canDrive) {
      throw new ConflictError(
        "driver",
        "That shift is not open, or that driver cannot drive.",
      );
    }

    const [zoneRow] = await tx
      .select({ one: sql<number>`1` })
      .from(agentZones)
      .where(
        and(
          eq(agentZones.agentUserId, row.shift.staffUserId),
          eq(agentZones.zip, pickup.zip),
        ),
      )
      .limit(1);
    const inZone = zoneRow !== undefined;

    const [load] = await tx
      .select({ bags: sql<number>`coalesce(sum(${bookings.bagCount}), 0)::int` })
      .from(pickupTasks)
      .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
      .where(
        and(
          eq(pickupTasks.driverShiftId, input.shiftId),
          inArray(pickupTasks.status, [...OPEN_TASK_STATUSES]),
          sql`${pickupTasks.bookingId} <> ${booking.id}`,
        ),
      );
    const availableCapacity = bookableSpaces(row, load?.bags ?? 0);
    const hasRoom = availableCapacity >= booking.bagCount;

    const overrode: ("zone" | "capacity")[] = [];
    if (!inZone) overrode.push("zone");
    if (!hasRoom) overrode.push("capacity");

    if (overrode.length > 0 && !input.override) {
      throw new ConflictError(
        "driver",
        overrode.includes("capacity")
          ? `${row.truckName} has ${availableCapacity} space${availableCapacity === 1 ? "" : "s"} left and this booking is ${booking.bagCount} bags. Tick the override to place it anyway.`
          : `That driver does not cover ZIP ${pickup.zip}. Tick the override to place it anyway.`,
      );
    }

    const releasedShiftId =
      task.driverShiftId && task.driverShiftId !== input.shiftId
        ? task.driverShiftId
        : null;

    await tx
      .update(pickupTasks)
      .set({
        driverShiftId: input.shiftId,
        assigneeUserId: row.shift.staffUserId,
        // A reassignment resets the run: the new driver has not set off, and
        // leaving `started_at` from the previous one would make the customer's
        // page claim somebody is on the way who is not.
        status: "assigned",
        startedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pickupTasks.id, task.id));

    await tx.insert(custodyEvents).values({
      bookingId: booking.id,
      actorUserId: input.adminUserId,
      actorRole: "admin",
      eventType: PICKUP_EVENT_TYPES.reassigned,
      metadata: {
        shiftId: input.shiftId,
        truckName: row.truckName,
        driverUserId: row.shift.staffUserId,
        ...(releasedShiftId ? { releasedShiftId } : {}),
        ...(overrode.length > 0 ? { overrode } : {}),
      },
    });

    return { shiftId: input.shiftId, releasedShiftId, overrode };
  });
}

export interface AdminUnassignPickupInput {
  bookingId: string;
  adminUserId: string;
  /** Free text, written into the custody trail. Optional. */
  reason?: string;
}

export interface AdminUnassignPickupResult {
  /** The shift the pickup was taken off, or null if it had none. */
  releasedShiftId: string | null;
}

/**
 * Takes the driver off a pickup and leaves it UNASSIGNED.
 *
 * WHY THIS EXISTS SEPARATELY FROM REASSIGN. The console could move a pickup
 * from one shift to another and nothing else. So an admin who needed to undo
 * an assignment — the driver called in sick, the van broke down, the customer
 * picked somebody who then went off shift, or the assignment was simply wrong
 * — had to park the booking on some OTHER driver who was not going to do it
 * either. Every one of those is a lie told to the dispatch board, and the
 * board is what decides who gets chased.
 *
 * An unassigned sealed booking is not a gap in the record; it is exactly what
 * the board's at-risk flag exists to surface (`dispatch.ts`,
 * `awaitingDriverToday`). This puts the booking back in front of a human
 * instead of hiding it behind a name.
 *
 * THE TASK GOES BACK TO `pending`, not to a half state — the same release
 * `adminForceEndShift` performs when a shift ends under its load: shift
 * cleared, assignee cleared, `started_at` cleared. The customer's shortlist
 * reopens, so they can choose again.
 *
 * REFUSED ONCE THE BAGS ARE IN THE VAN. `in_transit` and beyond means the
 * driver physically has the luggage, and re-listing the booking for another
 * driver to collect from a door the bags have already left would be a lie of
 * a different kind. `adminForceEndShift` handles that case by raising an
 * EXCEPTION, which pages ops — that is the honest route, and this one names
 * it rather than duplicating it. TD chose the refusal over silently doing
 * something exceptional under a routine button.
 */
export async function adminUnassignPickup(
  config: CoreConfig,
  input: AdminUnassignPickupInput,
): Promise<AdminUnassignPickupResult> {
  const { db } = config;
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);
  if (!booking) throw new NotFoundError("Booking", input.bookingId);

  /*
   * THE IN-TRANSIT REFUSAL STAYS HERE, and only it. Its sentence names
   * force-end-shift as the honest route, which is a fact about the incident
   * path rather than about the booking's standing — see the header.
   */
  if (booking.status === "in_transit") {
    throw new ConflictError(
      "driver",
      `The bags for ${booking.ref} are already in this driver's van. Unassigning would re-list them for collection from a door they have left. Force-end the shift instead — that releases the run AND raises an exception, which pages ops.`,
    );
  }

  // Everything else — complete, cancelled, already with the airline — is the
  // shared gate. It is where the `cancelled` case this used to miss lives.
  const gate = assignmentGate("pickup", booking, false);
  if (!gate.allowed) throw new ConflictError("driver", gate.reason!);

  return db.transaction(async (tx) => {
    const task = await tx.query.pickupTasks.findFirst({
      where: eq(pickupTasks.bookingId, booking.id),
    });
    if (!task) throw new NotFoundError("Pickup task for booking", booking.id);

    const releasedShiftId = task.driverShiftId;
    if (releasedShiftId === null && task.assigneeUserId === null) {
      throw new ConflictError(
        "driver",
        `Nobody is assigned to ${booking.ref} — there is nothing to remove.`,
      );
    }

    await tx
      .update(pickupTasks)
      .set({
        driverShiftId: null,
        assigneeUserId: null,
        status: "pending",
        // Same reset a reassignment performs: a cleared run has not started,
        // and a stale `started_at` would make the customer's page claim
        // somebody is on the way who is not.
        startedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pickupTasks.id, task.id));

    await tx.insert(custodyEvents).values({
      bookingId: booking.id,
      actorUserId: input.adminUserId,
      actorRole: "admin",
      eventType: PICKUP_EVENT_TYPES.unassigned,
      metadata: {
        ...(releasedShiftId ? { releasedShiftId } : {}),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      },
    });

    return { releasedShiftId };
  });
}

/**
 * Open shifts a pickup can be moved to, with whether each would need an
 * override. The console's reassign picker.
 */
export interface ReassignOption {
  shiftId: string;
  staffUserId: string;
  driverName: string | null;
  truckName: string;
  bagCapacity: number;
  /** Held back by ops. The console shows it so a "full" van is explicable. */
  reservedSpaces: number;
  bagsOnBoard: number;
  inZone: boolean;
  hasRoom: boolean;
}

export async function listReassignOptions(
  db: Database,
  bookingId: string,
): Promise<ReassignOption[]> {
  const [row] = await db
    .select({ bagCount: bookings.bagCount, zip: bookings.pickupZip })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) throw new NotFoundError("Booking", bookingId);

  const rows = await eligibleShifts(db, row.zip.slice(0, 5));
  return rows.map((r) => ({
    shiftId: r.shiftId,
    staffUserId: r.staffUserId,
    driverName: r.fullName,
    truckName: r.truckName,
    bagCapacity: r.bagCapacity,
    reservedSpaces: r.reservedSpaces,
    bagsOnBoard: r.bagsOnBoard,
    hasRoom: bookableSpaces(r, r.bagsOnBoard) >= row.bagCount,
    inZone: r.inZone,
  }));
}
