import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bookings,
  custodyEvents,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Database,
  type DriverShift,
  type Truck,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import {
  ConflictError,
  InvalidInputError,
  NotAuthorizedError,
  NotFoundError,
} from "../errors";
import { applyTransition } from "./bookings";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import { OPEN_TASK_STATUSES } from "./tasks";

/**
 * Driver shifts — who is out, in which truck, right now.
 *
 * A shift is the unit a pickup is assigned to, not a person: the truck is what
 * has finite capacity and what physically holds the bags. That is what makes
 * "you cannot clock off, there are bags in your van" a query instead of a
 * convention, and it is enforced here rather than in the agent UI, because a
 * server action stays a reachable POST whatever the UI renders.
 *
 * Two invariants live in the DATABASE, not in this file — partial unique
 * indexes on `driver_shifts` (`WHERE ended_at IS NULL`): one open shift per
 * person, one per truck. This module catches `23505` and turns it into a
 * sentence a driver can act on. That is the house pattern (`dispatch.ts`), and
 * it is what makes two taps on "Start shift" produce one shift rather than a
 * race nobody notices until two people are dispatched to the same van.
 *
 * AGENTS DO NOT HAVE SHIFTS. Only drivers. The reasoning is written at the
 * auto-assign call site in `auto-assign.ts`; it is a decision, not a gap.
 */

/** Postgres SQLSTATE from a raw or drizzle-wrapped error (walks `.cause`). */
function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface ActiveShift {
  shift: DriverShift;
  truck: Truck;
  /** Bags currently committed to this shift — the capacity numerator. */
  bagsOnBoard: number;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The open shift for one person, or null. */
export async function getActiveShift(
  db: Database,
  staffUserId: string,
): Promise<ActiveShift | null> {
  const [row] = await db
    .select({ shift: driverShifts, truck: trucks })
    .from(driverShifts)
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .where(and(eq(driverShifts.staffUserId, staffUserId), isNull(driverShifts.endedAt)))
    .limit(1);

  if (!row) return null;
  return { ...row, bagsOnBoard: await bagsOnShift(db, row.shift.id) };
}

/**
 * Bags committed to a shift: the sum of `bookings.bag_count` over its pickup
 * tasks that are still open.
 *
 * Summed from the BOOKING rather than counted per task, because a task is one
 * booking and a booking can be four bags — counting tasks would let a truck
 * with a 12-bag capacity accept twelve four-bag runs.
 */
export async function bagsOnShift(db: Database, shiftId: string): Promise<number> {
  const [row] = await db
    .select({ bags: sql<number>`coalesce(sum(${bookings.bagCount}), 0)::int` })
    .from(pickupTasks)
    .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
    .where(
      and(
        eq(pickupTasks.driverShiftId, shiftId),
        inArray(pickupTasks.status, [...OPEN_TASK_STATUSES]),
      ),
    );
  return row?.bags ?? 0;
}

export interface ShiftBlocker {
  taskId: string;
  bookingId: string;
  /** `KOO-XXXXX` — what a driver reads off their own screen. */
  ref: string;
  bookingStatus: string;
  bagCount: number;
}

/** Open pickup tasks still attached to a shift — the reason it cannot end. */
export async function shiftBlockers(
  db: Database,
  shiftId: string,
): Promise<ShiftBlocker[]> {
  return db
    .select({
      taskId: pickupTasks.id,
      bookingId: bookings.id,
      ref: bookings.ref,
      bookingStatus: bookings.status,
      bagCount: bookings.bagCount,
    })
    .from(pickupTasks)
    .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
    .where(
      and(
        eq(pickupTasks.driverShiftId, shiftId),
        inArray(pickupTasks.status, [...OPEN_TASK_STATUSES]),
      ),
    )
    .orderBy(bookings.ref);
}

export interface TruckOption extends Truck {
  /** Whose shift is holding it, when one is. */
  heldByUserId: string | null;
}

/**
 * Active trucks and whether each is already out.
 *
 * Held trucks are RETURNED, not filtered out: a driver who cannot find their
 * van in the list learns nothing, where a van greyed out as "out with someone
 * else" is an answer. The caller decides how to render it; `startShift`
 * refuses either way.
 */
export async function listTruckOptions(db: Database): Promise<TruckOption[]> {
  const rows = await db
    .select({ truck: trucks, heldByUserId: driverShifts.staffUserId })
    .from(trucks)
    .leftJoin(
      driverShifts,
      and(eq(driverShifts.truckId, trucks.id), isNull(driverShifts.endedAt)),
    )
    .where(eq(trucks.active, true))
    .orderBy(trucks.name);
  return rows.map((r) => ({ ...r.truck, heldByUserId: r.heldByUserId }));
}

export interface TruckRow extends Truck {
  /** Whose shift is holding it, when one is. */
  heldByUserId: string | null;
  heldByName: string | null;
  /** Bags on board right now. Zero when the truck is not out. */
  bagsOnBoard: number;
}

/** Every truck, active or not — the console's fleet list. */
export async function listTrucks(db: Database): Promise<TruckRow[]> {
  const bagsOnBoardSql = sql<number>`(
    select coalesce(sum(b.bag_count), 0)::int
      from ${pickupTasks} pt
      join ${bookings} b on b.id = pt.booking_id
     where pt.driver_shift_id = ${driverShifts.id}
       and pt.status in ('pending', 'assigned', 'in_progress')
  )`;

  const rows = await db
    .select({
      truck: trucks,
      heldByUserId: driverShifts.staffUserId,
      heldByName: users.fullName,
      bagsOnBoard: bagsOnBoardSql,
    })
    .from(trucks)
    .leftJoin(
      driverShifts,
      and(eq(driverShifts.truckId, trucks.id), isNull(driverShifts.endedAt)),
    )
    .leftJoin(users, eq(users.id, driverShifts.staffUserId))
    .orderBy(trucks.name);

  return rows.map((r) => ({
    ...r.truck,
    heldByUserId: r.heldByUserId,
    heldByName: r.heldByName,
    bagsOnBoard: r.heldByUserId ? (r.bagsOnBoard ?? 0) : 0,
  }));
}

export interface ShiftRow {
  shiftId: string;
  staffUserId: string;
  staffName: string | null;
  staffEmail: string | null;
  truckId: string;
  truckName: string;
  bagCapacity: number;
  bagsOnBoard: number;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Shifts for the console: every open one first, then the most recent closed
 * ones.
 *
 * Recent history is included because the first question after "who is out" is
 * "who just finished" — a driver who clocked off ten minutes ago is still the
 * person to call about the run they just did.
 */
export async function listShifts(
  db: Database,
  options: {
    limit?: number;
    /** Narrows to one person — the staff work-history view. */
    staffUserId?: string;
  } = {},
): Promise<ShiftRow[]> {
  const bagsOnBoardSql = sql<number>`(
    select coalesce(sum(b.bag_count), 0)::int
      from ${pickupTasks} pt
      join ${bookings} b on b.id = pt.booking_id
     where pt.driver_shift_id = ${driverShifts.id}
       and pt.status in ('pending', 'assigned', 'in_progress')
  )`;

  const rows = await db
    .select({
      shiftId: driverShifts.id,
      staffUserId: driverShifts.staffUserId,
      staffName: users.fullName,
      staffEmail: users.email,
      truckId: trucks.id,
      truckName: trucks.name,
      bagCapacity: trucks.bagCapacity,
      bagsOnBoard: bagsOnBoardSql,
      startedAt: driverShifts.startedAt,
      endedAt: driverShifts.endedAt,
    })
    .from(driverShifts)
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .where(
      options.staffUserId === undefined
        ? undefined
        : eq(driverShifts.staffUserId, options.staffUserId),
    )
    // Open shifts first (NULL sorts last under DESC NULLS LAST, so this is
    // spelled explicitly), then most recently started.
    .orderBy(sql`${driverShifts.endedAt} is not null`, desc(driverShifts.startedAt))
    .limit(options.limit ?? 50);

  return rows.map((r) => ({ ...r, bagsOnBoard: r.bagsOnBoard ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* Fleet administration                                                */
/* ------------------------------------------------------------------ */

/**
 * A RESERVE MUST LEAVE AT LEAST ONE BOOKABLE SPACE.
 *
 * `reserved_spaces >= bag_capacity` is a truck that can never be offered to
 * anybody: `bookableSpaces` returns 0 for every booking, so it disappears from
 * every shortlist and every reassign picker while still looking active and
 * fully crewed in the console. Taking a van out of service is what the
 * `active` toggle is for, and it says so on screen; a reserve that silently
 * does the same thing is a van nobody can explain.
 *
 * Enforced here rather than as a CHECK constraint because the two columns are
 * edited together by one form, and the message an operator needs names both
 * numbers. A constraint would say `23514`.
 */
function assertReserveLeavesRoom(reservedSpaces: number, bagCapacity: number): void {
  if (reservedSpaces >= bagCapacity) {
    throw new InvalidInputError(
      "reservedSpaces",
      `Holding ${reservedSpaces} of ${bagCapacity} spaces back would leave nothing bookable. ` +
        `Reserve fewer than the capacity, or take the truck out of service instead.`,
    );
  }
}

export interface OnBehalfDriverOption {
  staffUserId: string;
  name: string | null;
  email: string | null;
  /** The shift they are already on, when there is one. */
  activeShiftTruckName: string | null;
}

/**
 * Everyone an admin could start a shift for.
 *
 * Cleared drivers only — active staff with `can_drive` — because
 * `can_drive` defaults FALSE and granting it is a deliberate act on the same
 * page. Somebody who has not been granted it is not a candidate whose name
 * belongs in a picker; they are a `/staff` task.
 *
 * Drivers already out are RETURNED, not filtered, for the same reason
 * `listTruckOptions` returns held trucks: a name missing from a list teaches
 * nothing, and "already out with Van A" is an answer. The caller disables
 * them; `startShift` refuses either way, so the list is a convenience and
 * never the guarantee.
 */
export async function listOnBehalfDriverOptions(
  db: Database,
): Promise<OnBehalfDriverOption[]> {
  const rows = await db
    .select({
      staffUserId: staffMembers.userId,
      name: users.fullName,
      email: users.email,
      activeShiftTruckName: trucks.name,
    })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .leftJoin(
      driverShifts,
      and(
        eq(driverShifts.staffUserId, staffMembers.userId),
        isNull(driverShifts.endedAt),
      ),
    )
    .leftJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .where(and(eq(staffMembers.active, true), eq(staffMembers.canDrive, true)))
    .orderBy(users.fullName, users.email);

  return rows.map((r) => ({
    staffUserId: r.staffUserId,
    name: r.name,
    email: r.email,
    activeShiftTruckName: r.activeShiftTruckName,
  }));
}

export interface CreateTruckInput {
  name: string;
  bagCapacity: number;
  reservedSpaces?: number;
}

export async function createTruck(db: Database, input: CreateTruckInput): Promise<Truck> {
  const name = input.name.trim();
  if (!name) throw new InvalidInputError("name", "Give the truck a name.");
  if (!Number.isInteger(input.bagCapacity) || input.bagCapacity < 1) {
    throw new InvalidInputError("bagCapacity", "Capacity must be at least one bag.");
  }
  const reservedSpaces = input.reservedSpaces ?? 0;
  if (!Number.isInteger(reservedSpaces) || reservedSpaces < 0) {
    throw new InvalidInputError("reservedSpaces", "Reserved spaces cannot be negative.");
  }
  assertReserveLeavesRoom(reservedSpaces, input.bagCapacity);

  try {
    const [row] = await db
      .insert(trucks)
      .values({ name, bagCapacity: input.bagCapacity, reservedSpaces })
      .returning();
    if (!row) throw new Error("Insert of truck returned no row");
    return row;
  } catch (error) {
    if (pgErrorCode(error) === "23505") {
      throw new ConflictError("shift", `There is already a truck called ${name}.`);
    }
    throw error;
  }
}

export interface UpdateTruckInput {
  id: string;
  name?: string;
  bagCapacity?: number;
  reservedSpaces?: number;
  active?: boolean;
}

/**
 * Edits a truck.
 *
 * DEACTIVATING A TRUCK THAT IS OUT IS REFUSED, with the driver named. The van
 * is on the road with somebody in it; taking it out of service under them
 * would leave an open shift referencing an inactive truck, which every read in
 * `driver-selection.ts` filters out — the driver would silently vanish from
 * every customer's shortlist while still holding bags. End the shift first
 * (`adminForceEndShift` if the driver cannot).
 *
 * Capacity CAN be reduced below what is currently on board. That is deliberate:
 * the number is being corrected, and refusing the correction would not unload
 * the van. Selection recomputes from the new figure and simply offers no more
 * space.
 */
export async function updateTruck(db: Database, input: UpdateTruckInput): Promise<Truck> {
  const existing = await db.query.trucks.findFirst({ where: eq(trucks.id, input.id) });
  if (!existing) throw new NotFoundError("Truck", input.id);

  if (input.active === false && existing.active) {
    const [held] = await db
      .select({ name: users.fullName, email: users.email })
      .from(driverShifts)
      .innerJoin(users, eq(users.id, driverShifts.staffUserId))
      .where(and(eq(driverShifts.truckId, input.id), isNull(driverShifts.endedAt)))
      .limit(1);
    if (held) {
      const who = held.name?.trim() || held.email || "a driver";
      throw new ConflictError(
        "shift",
        `${existing.name} is out with ${who}. End that shift before taking it out of service.`,
      );
    }
  }

  const name = input.name?.trim();
  if (input.name !== undefined && !name) {
    throw new InvalidInputError("name", "Give the truck a name.");
  }
  if (
    input.bagCapacity !== undefined &&
    (!Number.isInteger(input.bagCapacity) || input.bagCapacity < 1)
  ) {
    throw new InvalidInputError("bagCapacity", "Capacity must be at least one bag.");
  }
  if (
    input.reservedSpaces !== undefined &&
    (!Number.isInteger(input.reservedSpaces) || input.reservedSpaces < 0)
  ) {
    throw new InvalidInputError("reservedSpaces", "Reserved spaces cannot be negative.");
  }
  // Checked against whichever of the two is CHANGING, plus whichever is not.
  // Lowering capacity under an existing reserve is the same mistake as raising
  // the reserve past capacity, and an edit form posts both fields.
  assertReserveLeavesRoom(
    input.reservedSpaces ?? existing.reservedSpaces,
    input.bagCapacity ?? existing.bagCapacity,
  );

  try {
    const [row] = await db
      .update(trucks)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(input.bagCapacity === undefined ? {} : { bagCapacity: input.bagCapacity }),
        ...(input.reservedSpaces === undefined
          ? {}
          : { reservedSpaces: input.reservedSpaces }),
        ...(input.active === undefined ? {} : { active: input.active }),
        updatedAt: new Date(),
      })
      .where(eq(trucks.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Truck", input.id);
    return row;
  } catch (error) {
    if (pgErrorCode(error) === "23505") {
      throw new ConflictError("shift", `There is already a truck called ${name}.`);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface StartShiftInput {
  staffUserId: string;
  truckId: string;
  /**
   * The ADMIN opening this shift on the driver's behalf. Omitted when the
   * driver starts it themselves, which is the ordinary case and what a null
   * `started_by_user_id` means.
   */
  startedByUserId?: string;
}

/**
 * Opens a shift. Refuses unless the person is active staff who may drive and
 * the truck is active, and unless both are free.
 *
 * The freeness check is the database's, not ours: two concurrent starts both
 * pass any SELECT we could write, and only the partial unique index refuses
 * the second. The `23505` handler then re-reads to say WHICH half collided,
 * because "you already have a shift" and "that van is out with Nina" want
 * different actions from the driver.
 */
export async function startShift(
  config: CoreConfig,
  input: StartShiftInput,
): Promise<ActiveShift> {
  const { db } = config;

  const staff = await db.query.staffMembers.findFirst({
    where: eq(staffMembers.userId, input.staffUserId),
  });
  if (!staff || !staff.active) {
    throw new NotAuthorizedError("No active staff role for this account.");
  }
  if (!staff.canDrive) {
    throw new NotAuthorizedError(
      "This account is not cleared to drive. An admin grants that on the Staff page.",
    );
  }

  const truck = await db.query.trucks.findFirst({ where: eq(trucks.id, input.truckId) });
  if (!truck) throw new NotFoundError("Truck", input.truckId);
  if (!truck.active) {
    throw new InvalidInputError("truckId", `${truck.name} is out of service.`);
  }

  try {
    const [shift] = await db
      .insert(driverShifts)
      .values({
        staffUserId: input.staffUserId,
        truckId: truck.id,
        startedAt: config.clock.now(),
        ...(input.startedByUserId === undefined
          ? {}
          : { startedByUserId: input.startedByUserId }),
      })
      .returning();
    if (!shift) throw new Error("Insert of driver shift returned no row");
    // A brand-new shift carries nothing; no need to ask the database.
    return { shift, truck, bagsOnBoard: 0 };
  } catch (error) {
    if (pgErrorCode(error) !== "23505") throw error;
    throw await describeShiftCollision(db, input);
  }
}

export interface AdminStartShiftOnBehalfInput {
  staffUserId: string;
  truckId: string;
  /** The admin doing it. Stamped on the row; admin-ness is the action layer's. */
  adminUserId: string;
}

/**
 * Opens a shift FOR somebody else.
 *
 * THE PAIR TO `adminForceEndShift`, which has existed since Tier 4. The
 * console could take a driver OFF the road and not put one back on it: a
 * driver with a dead phone, a locked-out account or an app that will not load
 * had to be talked through starting their own shift, or the van stayed parked
 * and every sealed booking in that zone read "needs a driver".
 *
 * SAME ELIGIBILITY AS SELF-START, and not a copy of it. This calls
 * `startShift`, so active staff, `can_drive`, an active truck, and both
 * partial unique indexes are enforced by exactly the same code — including
 * the 23505 path that turns two concurrent starts into one shift and a
 * sentence saying which half collided. A second implementation here is how
 * the two would drift, and the one that drifts is the one nobody drives every
 * day.
 *
 * The refusal messages are re-pointed, though. `startShift` speaks to the
 * driver ("You are already on shift with…"), and an admin reading that about
 * somebody else has to work out who "you" is.
 *
 * NO REASON IS REQUIRED, unlike force-end. Ending somebody's shift strands
 * bags and raises exceptions; starting one is routine dispatch. Demanding a
 * justification for an ordinary act trains people to type "x".
 */
export async function adminStartShiftOnBehalf(
  config: CoreConfig,
  input: AdminStartShiftOnBehalfInput,
): Promise<ActiveShift> {
  try {
    return await startShift(config, {
      staffUserId: input.staffUserId,
      truckId: input.truckId,
      startedByUserId: input.adminUserId,
    });
  } catch (error) {
    // Re-point the second person. Everything else — the guards, the codes,
    // the error classes — is `startShift`'s and stays as it is.
    if (error instanceof ConflictError) {
      throw new ConflictError("shift", error.message.replace(/^You are/, "They are"));
    }
    throw error;
  }
}

/** Turns a 23505 on either partial unique index into a usable sentence. */
async function describeShiftCollision(
  db: Database,
  input: StartShiftInput,
): Promise<ConflictError> {
  const mine = await getActiveShift(db, input.staffUserId);
  if (mine) {
    return new ConflictError(
      "shift",
      `You are already on shift with ${mine.truck.name}. End that shift before starting another.`,
    );
  }

  const [held] = await db
    .select({ name: users.fullName, email: users.email })
    .from(driverShifts)
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .where(and(eq(driverShifts.truckId, input.truckId), isNull(driverShifts.endedAt)))
    .limit(1);

  const who = held?.name?.trim() || held?.email || "another driver";
  return new ConflictError("shift", `That truck is already out with ${who}.`);
}

export interface EndShiftResult {
  shift: DriverShift;
}

/**
 * Closes the caller's own shift.
 *
 * REFUSES while any pickup on the shift is still open — bags on the truck mean
 * the shift cannot end, and the error names the bookings so the driver knows
 * what they are still holding rather than being told "no". An admin can
 * override with `adminForceEndShift`, which puts those pickups back in the
 * pool rather than pretending they finished.
 */
export async function endShift(
  config: CoreConfig,
  input: { staffUserId: string },
): Promise<EndShiftResult> {
  const { db } = config;

  const active = await getActiveShift(db, input.staffUserId);
  if (!active) {
    throw new NotFoundError("Active shift for user", input.staffUserId);
  }

  const blockers = await shiftBlockers(db, active.shift.id);
  if (blockers.length > 0) {
    throw new ConflictError("shift", blockedShiftMessage(blockers));
  }

  const [ended] = await db
    .update(driverShifts)
    .set({ endedAt: config.clock.now(), updatedAt: new Date() })
    // `ended_at IS NULL` makes this a compare-and-swap: a concurrent end (or a
    // force-end from the console) wins and this one finds nothing to update.
    .where(and(eq(driverShifts.id, active.shift.id), isNull(driverShifts.endedAt)))
    .returning();

  if (!ended) {
    throw new ConflictError("shift", "That shift was already ended.");
  }
  return { shift: ended };
}

function blockedShiftMessage(blockers: ShiftBlocker[]): string {
  const refs = blockers.map((b) => b.ref).join(", ");
  const bags = blockers.reduce((sum, b) => sum + b.bagCount, 0);
  return blockers.length === 1
    ? `You still have ${bags} bag${bags === 1 ? "" : "s"} for ${refs}. Finish or hand over that pickup before ending your shift.`
    : `You still have ${blockers.length} open pickups (${refs}) — ${bags} bags. Finish or hand them over before ending your shift.`;
}

export interface AdminForceEndShiftInput {
  shiftId: string;
  adminUserId: string;
  /** Required, free text, appended to every affected booking's custody trail. */
  reason: string;
}

export interface AdminForceEndShiftResult {
  shift: DriverShift;
  /** Pickups put back in the pool. */
  released: ShiftBlocker[];
  /** Bookings whose bags were already in transit and are now exceptions. */
  raisedExceptions: string[];
}

/**
 * Ends somebody else's shift, with a reason, and does something honest with
 * whatever was on the truck.
 *
 * The van broke down, the driver's phone died, the person went home without
 * clocking off. `endShift` refuses in all three; this does not — but it never
 * pretends the pickups completed. Each open pickup is RELEASED: shift cleared,
 * assignee cleared, status back to `pending`, and a custody event naming the
 * reason. An unassigned sealed booking is what the dispatch board's at-risk
 * flag is for (see `dispatch.ts`), so releasing is what puts these in front of
 * a human.
 *
 * ONE CASE GETS MORE THAN A RELEASE. A booking already `in_transit` has its
 * bags physically inside a van whose shift just ended — that is not a
 * dispatch gap, it is an incident, and re-listing it for another driver to
 * collect from a door the bags have already left would be a lie. Those
 * bookings are raised to `exception` through `applyTransition`, which is also
 * what emits `booking/exception_raised` and pages ops. Beyond that
 * (`delivered_to_bagdrop`, `completed`) the bags are the airline's and the
 * task is closed, so nothing is open to release.
 *
 * Admin-only. Enforced at the action layer, like every other admin write.
 */
export async function adminForceEndShift(
  config: CoreConfig,
  input: AdminForceEndShiftInput,
): Promise<AdminForceEndShiftResult> {
  const { db } = config;

  const reason = input.reason.trim();
  if (!reason) {
    throw new InvalidInputError(
      "reason",
      "Force-ending a shift needs a reason — it is written into the custody trail of every booking it touches.",
    );
  }

  const shift = await db.query.driverShifts.findFirst({
    where: eq(driverShifts.id, input.shiftId),
  });
  if (!shift) throw new NotFoundError("Shift", input.shiftId);
  if (shift.endedAt) {
    throw new ConflictError("shift", "That shift has already ended.");
  }

  const blockers = await shiftBlockers(db, shift.id);
  const inTransit = blockers.filter((b) => b.bookingStatus === "in_transit");

  const ended = await db.transaction(async (tx) => {
    for (const blocker of blockers) {
      await tx
        .update(pickupTasks)
        .set({
          driverShiftId: null,
          assigneeUserId: null,
          status: "pending",
          startedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(pickupTasks.id, blocker.taskId));

      await tx.insert(custodyEvents).values({
        bookingId: blocker.bookingId,
        actorUserId: input.adminUserId,
        actorRole: "admin",
        eventType: PICKUP_EVENT_TYPES.shift_force_ended,
        metadata: {
          shiftId: shift.id,
          truckId: shift.truckId,
          releasedFromUserId: shift.staffUserId,
          reason,
        },
      });
    }

    const [row] = await tx
      .update(driverShifts)
      .set({ endedAt: config.clock.now(), updatedAt: new Date() })
      .where(and(eq(driverShifts.id, shift.id), isNull(driverShifts.endedAt)))
      .returning();
    return row ?? null;
  });

  if (!ended) {
    throw new ConflictError("shift", "That shift was ended by someone else first.");
  }

  // AFTER the release commits, so a booking is never left in `exception` with
  // a driver still attached. `applyTransition` is the only path that raises —
  // it is also what emits the ops alert (see §7 of PROJECT-STATUS).
  const raisedExceptions: string[] = [];
  for (const blocker of inTransit) {
    const moved = await applyTransition(config, {
      bookingId: blocker.bookingId,
      event: "raise_exception",
      actor: { userId: input.adminUserId, role: "admin" },
      metadata: {
        reason: "driver_shift_force_ended",
        detail: reason,
        shiftId: shift.id,
      },
    });
    if (moved.ok) raisedExceptions.push(blocker.bookingId);
  }

  return { shift: ended, released: blockers, raisedExceptions };
}
