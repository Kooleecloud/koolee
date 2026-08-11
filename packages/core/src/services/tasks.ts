import { and, eq } from "drizzle-orm";
import {
  airports,
  bookings,
  pickupTasks,
  verificationTasks,
  type Database,
  type PickupTask,
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
  const [verification, pickup] = await Promise.all([
    db
      .select({ task: verificationTasks, tz: airports.tz })
      .from(verificationTasks)
      .innerJoin(bookings, eq(bookings.id, verificationTasks.bookingId))
      .innerJoin(airports, eq(airports.code, bookings.departureAirport))
      .where(eq(verificationTasks.assigneeUserId, assigneeUserId))
      .orderBy(verificationTasks.scheduledStart),
    db
      .select({ task: pickupTasks, tz: airports.tz })
      .from(pickupTasks)
      .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
      .innerJoin(airports, eq(airports.code, bookings.departureAirport))
      .where(eq(pickupTasks.assigneeUserId, assigneeUserId))
      .orderBy(pickupTasks.scheduledStart),
  ]);

  return { verification, pickup };
}
