import { and, eq } from "drizzle-orm";
import {
  airports,
  bookings,
  pickupTasks,
  verificationTasks,
  type Database,
  type PickupTask,
  type TaskStatus,
  type VerificationTask,
} from "@koolee/db";

/**
 * Task reads for the agent app.
 *
 * Agents are task-scoped (see `auth/types.ts`): a task detail is only
 * readable by its assignee, so the lookup carries the assignee in the WHERE
 * clause rather than checking after the fact — an unassigned task id simply
 * does not resolve.
 */

export type TaskKind = "verification" | "pickup";

/**
 * Task statuses that still represent work somebody has to do.
 *
 * `done` and `failed` are both finished — a failed visit has already been
 * handed to the exception flow, and counting it as load would keep a person
 * artificially busy for the rest of the day.
 *
 * Three readers depend on this being ONE list: the admin workload strip
 * (`listAgentWorkload`), a driver's remaining bag load (`driver-selection.ts`),
 * and the guard that refuses to end a shift with bags still on the truck
 * (`shifts.ts`). They must agree on what "open" means or a driver clocks off
 * mid-run.
 */
export const OPEN_TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
] as const satisfies readonly TaskStatus[];

export type AssignedTask =
  | { kind: "verification"; task: VerificationTask }
  | { kind: "pickup"; task: PickupTask };

export async function getAssignedTask(
  db: Database,
  input: { taskId: string; kind: TaskKind; assigneeUserId: string },
): Promise<AssignedTask | null> {
  if (input.kind === "verification") {
    const task = await db.query.verificationTasks.findFirst({
      where: and(
        eq(verificationTasks.id, input.taskId),
        eq(verificationTasks.assigneeUserId, input.assigneeUserId),
      ),
    });
    return task ? { kind: "verification", task } : null;
  }
  const task = await db.query.pickupTasks.findFirst({
    where: and(
      eq(pickupTasks.id, input.taskId),
      eq(pickupTasks.assigneeUserId, input.assigneeUserId),
    ),
  });
  return task ? { kind: "pickup", task } : null;
}

/* ------------------------------------------------------------------ */
/* Agent task queues                                                   */
/* ------------------------------------------------------------------ */

/**
 * A queued task with the zone its times must be read in.
 *
 * The zone travels WITH the task rather than being looked up by the page,
 * because a task with no zone attached is a task the agent app will render in
 * the server's zone — which is UTC in production, and put the agent hours away
 * from the window the customer actually bought.
 */
export interface ScheduledTask<T> {
  task: T;
  /** The booking's display zone (its departure airport's). See display-tz.ts. */
  tz: string;
  /**
   * The job in one glance — who, where, how many bags, which flight.
   *
   * The queue used to carry the task row alone, which made every entry read
   * identically ("Verify and seal", a time, a status chip): an agent with six
   * tasks could not tell them apart, let alone decide which to drive to. A
   * task is only meaningful in terms of the booking it serves, so the booking
   * travels with it rather than being fetched per row by the page.
   */
  booking: TaskBookingContext;
}

/** The booking fields an agent needs to identify and reach a job. */
export interface TaskBookingContext {
  id: string;
  /** `KOO-XXXXX` — what the customer quotes and what ops reads back. */
  ref: string;
  paxName: string;
  flightNumber: string;
  departureAirport: string;
  departureAt: Date;
  bagCount: number;
  status: string;
  /** Street line, for recognising the stop. */
  addressLine1: string;
  /** Apartment, floor, buzzer — the half that gets a driver past the door. */
  addressLine2: string | null;
  addressCity: string;
  addressState: string | null;
  addressZip: string | null;
  /**
   * The doorstep's precise point, when Places supplied one. Null is ordinary
   * (hand-typed address) and every consumer degrades to the ZIP centroid.
   */
  addressLat: number | null;
  addressLng: number | null;
  /**
   * Google Place ID, when the address was picked from autocomplete. The agent
   * app prefers it for the "Navigate" link: a place id resolves to the exact
   * pin the customer chose, where a free-text query can land on the wrong end
   * of a long street.
   */
  addressPlaceId: string | null;
  /**
   * The door contact. On the list, not just the visit detail — a driver
   * running late calls before opening the job.
   */
  contactPhone: string | null;
}

export interface AssignedTasks {
  verification: ScheduledTask<VerificationTask>[];
  pickup: ScheduledTask<PickupTask>[];
}

/**
 * Both task queues for one assignee, each row carrying its booking's zone.
 *
 * Verification and pickup are separate entities (see packages/db/README.md);
 * the agent app renders them as one list because the same person usually does
 * both, but that is a presentation choice, not a data one.
 */
export async function listAssignedTasks(
  db: Database,
  assigneeUserId: string,
): Promise<AssignedTasks> {
  // Selected once and reused by both queues so the two halves of the agent's
  // list can never describe the same booking differently.
  const bookingColumns = {
    id: bookings.id,
    ref: bookings.ref,
    paxName: bookings.paxName,
    flightNumber: bookings.flightNumber,
    departureAirport: bookings.departureAirport,
    departureAt: bookings.departureAt,
    bagCount: bookings.bagCount,
    status: bookings.status,
    // The booking's OWN doorstep (0033). These were a join on `addresses`
    // until the snapshot landed, which meant a customer editing their saved
    // address could move a stop out from under a driver already holding the
    // job.
    addressLine1: bookings.pickupLine1,
    addressLine2: bookings.pickupLine2,
    addressCity: bookings.pickupCity,
    addressState: bookings.pickupState,
    addressZip: bookings.pickupZip,
    addressLat: bookings.pickupLat,
    addressLng: bookings.pickupLng,
    addressPlaceId: bookings.pickupPlaceId,
    contactPhone: bookings.contactPhone,
  };

  const [verification, pickup] = await Promise.all([
    db
      .select({ task: verificationTasks, tz: airports.tz, booking: bookingColumns })
      .from(verificationTasks)
      .innerJoin(bookings, eq(bookings.id, verificationTasks.bookingId))
      .innerJoin(airports, eq(airports.code, bookings.departureAirport))
      .where(eq(verificationTasks.assigneeUserId, assigneeUserId))
      .orderBy(verificationTasks.scheduledStart),
    db
      .select({ task: pickupTasks, tz: airports.tz, booking: bookingColumns })
      .from(pickupTasks)
      .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
      .innerJoin(airports, eq(airports.code, bookings.departureAirport))
      .where(eq(pickupTasks.assigneeUserId, assigneeUserId))
      .orderBy(pickupTasks.scheduledStart),
  ]);

  return { verification, pickup };
}
