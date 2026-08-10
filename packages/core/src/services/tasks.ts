import { and, eq } from "drizzle-orm";
import {
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

export interface AssignedTasks {
  verification: VerificationTask[];
  pickup: PickupTask[];
}

/**
 * Both task queues for one assignee.
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
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.assigneeUserId, assigneeUserId))
      .orderBy(verificationTasks.scheduledStart),
    db
      .select()
      .from(pickupTasks)
      .where(eq(pickupTasks.assigneeUserId, assigneeUserId))
      .orderBy(pickupTasks.scheduledStart),
  ]);

  return { verification, pickup };
}
