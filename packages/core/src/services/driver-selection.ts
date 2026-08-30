import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import {
  addresses,
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
import { ConflictError, InvalidInputError, NotAuthorizedError, NotFoundError } from "../errors";
import { assertActionable } from "./actionability";
import { touchBookingSignals } from "./booking-signals";
import { toCoordinates, type Coordinates } from "../geo/coordinates";
import type { EtaRange } from "../geo/eta";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
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
  /** Bags already committed to this shift. */
  bagsOnBoard: number;
  /** `bagCapacity − bagsOnBoard`. Always ≥ the booking's bag count. */
  availableCapacity: number;
  /**
   * True when this driver does not cover the pickup ZIP and only appears
   * because nobody who does was available. The UI must say so.
   */
  outOfZone: boolean;
  /**
   * Null when the driver has never pinged a position — a real state, not an
   * error. Render `formatEtaRange(null)`, never a guess.
   */
  eta: EtaRange | null;
}

interface EligibleRow {
  shiftId: string;
  staffUserId: string;
  fullName: string | null;
  avatarStoragePath: string | null;
  truckName: string;
  bagCapacity: number;
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
async function eligibleShifts(
  db: Database,
  zip: string,
): Promise<EligibleRow[]> {
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
  const [row] = await db
    .select({
      booking: bookings,
      zip: addresses.zip,
      lat: addresses.lat,
      lng: addresses.lng,
    })
    .from(bookings)
    .innerJoin(addresses, eq(addresses.id, bookings.pickupAddressId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) throw new NotFoundError("Booking", bookingId);

  return {
    booking: row.booking,
    pickup: { zip: row.zip.slice(0, 5), coords: toCoordinates(row.lat, row.lng) },
  };
}

function assertSelectable(booking: Booking): void {
  if (
    !(DRIVER_SELECTABLE_STATUSES as readonly string[]).includes(booking.status)
  ) {
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
    (r) => r.bagCapacity - r.bagsOnBoard >= booking.bagCount,
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
    bagsOnBoard: row.bagsOnBoard,
    availableCapacity: row.bagCapacity - row.bagsOnBoard,
    outOfZone,
    eta,
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
  // reads is at most one GPS ping (~45s) older than the one re-read under the
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
    if (task.startedAt !== null || !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) {
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
    const availableCapacity = row.bagCapacity - bagsOnBoard;
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
      bagsOnBoard: bagsOnBoard + booking.bagCount,
      availableCapacity: availableCapacity - booking.bagCount,
      outOfZone: false,
      eta,
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
    console.error(`[driver-selection] pool-empty report failed for ${input.bookingId}`, error);
  }
}

/** The driver a booking currently has, for the trip page and the console. */
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
}

export async function getSelectedDriver(
  db: Database,
  bookingId: string,
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
    .leftJoin(
      driverPositions,
      eq(driverPositions.staffUserId, driverShifts.staffUserId),
    )
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
    .values({ staffUserId: input.staffUserId, lat: input.lat, lng: input.lng, recordedAt })
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

  if (booking.status === "delivered_to_bagdrop" || booking.status === "completed") {
    throw new ConflictError(
      "driver",
      `Booking ${booking.ref} is ${booking.status} — the bags are already with the airline.`,
    );
  }

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
        canDrive: staffMembers.canDrive,
        staffActive: staffMembers.active,
      })
      .from(driverShifts)
      .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
      .innerJoin(staffMembers, eq(staffMembers.userId, driverShifts.staffUserId))
      .where(and(eq(driverShifts.id, input.shiftId), isNull(driverShifts.endedAt)))
      .limit(1);

    if (!row || !row.staffActive || !row.canDrive) {
      throw new ConflictError("driver", "That shift is not open, or that driver cannot drive.");
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
    const availableCapacity = row.bagCapacity - (load?.bags ?? 0);
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
      task.driverShiftId && task.driverShiftId !== input.shiftId ? task.driverShiftId : null;

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
  bagsOnBoard: number;
  inZone: boolean;
  hasRoom: boolean;
}

export async function listReassignOptions(
  db: Database,
  bookingId: string,
): Promise<ReassignOption[]> {
  const [row] = await db
    .select({ bagCount: bookings.bagCount, zip: addresses.zip })
    .from(bookings)
    .innerJoin(addresses, eq(addresses.id, bookings.pickupAddressId))
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
    bagsOnBoard: r.bagsOnBoard,
    inZone: r.inZone,
    hasRoom: r.bagCapacity - r.bagsOnBoard >= row.bagCount,
  }));
}
