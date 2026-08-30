import { and, eq } from "drizzle-orm";
import {
  bookings,
  custodyEvents,
  passportVerifications,
  verificationTasks,
  type Database,
  type PassportVerification,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { ConflictError, NotFoundError } from "../errors";
import { assertActionable } from "./actionability";

/**
 * Passport verification — manual, human, and free.
 *
 * WHAT THIS SERVICE KNOWS ABOUT A PASSPORT: where its photo is, and what a
 * human decided about it. Nothing else, ever. No number, no name, no DOB, no
 * MRZ, and no extraction of any kind. See the schema comment on
 * `passport_verifications` for why that is a hard rule rather than a scope cut.
 *
 * TWO ENTRY PATHS INTO THE SAME CONFIRMATION:
 *
 *  1. the customer pre-uploads from their trip page (`recordCustomerUpload`)
 *     and the agent confirms the photo against the person at the door;
 *  2. nobody pre-uploaded, and the agent photographs the passport at the door
 *     (`recordAgentCapture`) then confirms.
 *
 * Pre-uploading is a CONVENIENCE, never a requirement — the second path is the
 * one that has to work at 6am on a doorstep with bad signal, so `confirmPassport`
 * is reachable from `pending` as well as `customer_uploaded`.
 *
 * AUTHORIZATION follows the established split: customer paths check booking
 * ownership; agent paths check ASSIGNMENT, using the same
 * assignee-in-the-WHERE-clause shape as `getAssignedTask` — an agent who is
 * not on this booking gets a 404, not a 403.
 */

/** Custody event names this module appends. Free-form text by design. */
export const PASSPORT_EVENT_TYPES = {
  customerUploaded: "passport.customer_uploaded",
  agentCaptured: "passport.agent_captured",
  confirmed: "passport.agent_confirmed",
} as const;

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getPassportVerification(
  db: Database,
  bookingId: string,
): Promise<PassportVerification | null> {
  const [row] = await db
    .select()
    .from(passportVerifications)
    .where(eq(passportVerifications.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

/**
 * True only at `agent_confirmed`. `customer_uploaded` is a photo nobody has
 * looked at yet, and the whole point of the manual model is that a human
 * compared the document to the person in front of them.
 */
export async function bookingPassportConfirmed(
  db: Database,
  bookingId: string,
): Promise<boolean> {
  const row = await getPassportVerification(db, bookingId);
  return row?.status === "agent_confirmed";
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Creates the row if absent, returns it either way. Kept private: every
 * public entry point owns its own authorization check first.
 */
async function ensureRow(db: Database, bookingId: string): Promise<PassportVerification> {
  const existing = await getPassportVerification(db, bookingId);
  if (existing) return existing;

  const [row] = await db
    .insert(passportVerifications)
    .values({ bookingId })
    .onConflictDoNothing({ target: passportVerifications.bookingId })
    .returning();
  if (row) return row;

  // Lost the race — the concurrent insert's row is the one to use.
  const after = await getPassportVerification(db, bookingId);
  if (!after) throw new NotFoundError("Passport verification", bookingId);
  return after;
}

/** Statuses at which a new photo may still be attached. */
const REPLACEABLE_STATUSES = new Set(["pending", "customer_uploaded"]);

export interface RecordCustomerUploadInput {
  bookingId: string;
  /** The signed-in customer. Must own the booking. */
  userId: string;
  /** Path in the PRIVATE `passport-photos` bucket. Never a URL. */
  storagePath: string;
}

/**
 * The customer's pre-upload.
 *
 * Replacing an existing photo is allowed while the verification is still
 * `pending` or `customer_uploaded`: people photograph the wrong page, or a
 * glare-ruined one, and discovering that at the door is the failure this
 * avoids. Each replace is its own custody event, and the OLD storage object is
 * deliberately NOT deleted in this slice — see the hardening note at the
 * bottom of this file.
 *
 * Once the agent has confirmed, the photo is evidence and stops being
 * replaceable.
 */
export async function recordCustomerUpload(
  config: CoreConfig,
  input: RecordCustomerUploadInput,
): Promise<PassportVerification> {
  const { db } = config;
  const storagePath = input.storagePath.trim();
  if (!storagePath) {
    throw new ConflictError("passport", "No passport photo was uploaded.");
  }

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  // 404 rather than 403 on someone else's booking — same reasoning as
  // `acceptAgreement`: a 403 confirms the id exists.
  if (!booking || booking.userId !== input.userId) {
    throw new NotFoundError("Booking", input.bookingId);
  }

  // Same reasoning as `acceptAgreement`: a booking past its bag-drop cutoff
  // is not one a passport photo can rescue, and one that is merely late is.
  await assertActionable(config, booking, "uploadPassport", {
    userId: input.userId,
    role: "customer",
  });

  const row = await ensureRow(db, booking.id);
  if (!REPLACEABLE_STATUSES.has(row.status)) {
    throw new ConflictError(
      "passport",
      row.status === "agent_confirmed"
        ? "Your passport has already been verified by the agent — there is nothing more to upload."
        : "This booking's passport check is with our team; please contact support.",
    );
  }

  return applyUpload(config, {
    bookingId: booking.id,
    storagePath,
    actorUserId: input.userId,
    actorRole: "customer",
    eventType: PASSPORT_EVENT_TYPES.customerUploaded,
    replacing: row.photoStoragePath,
  });
}

export interface RecordAgentCaptureInput {
  taskId: string;
  /** Path in the PRIVATE `passport-photos` bucket. Never a URL. */
  storagePath: string;
}

/**
 * The agent photographs the passport at the door.
 *
 * A DISTINCT custody event from the customer's upload (`passport.agent_captured`
 * vs `passport.customer_uploaded`) because they are different facts about who
 * produced the evidence, and a trail that conflates them cannot answer "who
 * took this photo" months later.
 *
 * Authorization is assignment, resolved through the task in the same shape as
 * `getAssignedTask`.
 */
export async function recordAgentCapture(
  config: CoreConfig,
  session: AgentSession,
  input: RecordAgentCaptureInput,
): Promise<PassportVerification> {
  const { db } = config;
  const storagePath = input.storagePath.trim();
  if (!storagePath) {
    throw new ConflictError("passport", "No passport photo was captured.");
  }

  const task = await assignedVerificationTask(db, session, input.taskId);
  const row = await ensureRow(db, task.bookingId);
  if (!REPLACEABLE_STATUSES.has(row.status)) {
    throw new ConflictError(
      "passport",
      "This passport has already been confirmed — flag a problem if something is wrong.",
    );
  }

  return applyUpload(config, {
    bookingId: task.bookingId,
    storagePath,
    actorUserId: session.userId,
    actorRole: session.role,
    eventType: PASSPORT_EVENT_TYPES.agentCaptured,
    replacing: row.photoStoragePath,
    taskId: task.id,
  });
}

/**
 * Confirms the passport matches the traveler.
 *
 * Works from `pending` as well as `customer_uploaded` — a pre-upload is
 * optional and the agent may have captured nothing at all through this service
 * (they can also have just looked at the document). What it will NOT do is
 * re-confirm: `agent_confirmed` is terminal-positive, and a second confirm
 * would overwrite `confirmed_by_agent_id` and `confirmed_at`, quietly
 * rewriting who vouched for this traveler and when.
 */
export async function confirmPassport(
  config: CoreConfig,
  session: AgentSession,
  input: { taskId: string; lat?: number | null; lng?: number | null },
): Promise<PassportVerification> {
  const { db } = config;
  const now = config.clock.now();

  const task = await assignedVerificationTask(db, session, input.taskId);
  const row = await ensureRow(db, task.bookingId);

  if (row.status === "agent_confirmed") return row;
  if (row.status === "failed") {
    throw new ConflictError(
      "passport",
      "This passport check was marked failed — the booking is with ops.",
    );
  }

  const updated = await db.transaction(async (tx) => {
    const [next] = await tx
      .update(passportVerifications)
      .set({
        status: "agent_confirmed",
        confirmedAt: now,
        confirmedByAgentId: session.userId,
      })
      .where(eq(passportVerifications.id, row.id))
      .returning();
    if (!next) throw new NotFoundError("Passport verification", row.id);

    await tx.insert(custodyEvents).values({
      bookingId: task.bookingId,
      actorUserId: session.userId,
      actorRole: session.role,
      eventType: PASSPORT_EVENT_TYPES.confirmed,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: {
        taskId: task.id,
        // Whether the photo came from the customer, the agent, or was never
        // taken at all. The confirmation means different things in each case.
        hadPhoto: next.photoStoragePath !== null,
      },
    });
    return next;
  });

  return updated;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * The assignment check, in the one shape used everywhere an agent acts:
 * assignee in the WHERE clause, so someone else's task simply does not
 * resolve. Never "fetch then compare".
 */
async function assignedVerificationTask(
  db: Database,
  session: AgentSession,
  taskId: string,
) {
  const task = await db.query.verificationTasks.findFirst({
    where: and(
      eq(verificationTasks.id, taskId),
      eq(verificationTasks.assigneeUserId, session.userId),
    ),
  });
  if (!task) throw new NotFoundError("Verification task", taskId);
  return task;
}

/** The shared write: photo path + status + custody event, in one transaction. */
async function applyUpload(
  config: CoreConfig,
  input: {
    bookingId: string;
    storagePath: string;
    actorUserId: string;
    actorRole: "customer" | "agent" | "driver" | "admin";
    eventType: string;
    replacing: string | null;
    taskId?: string;
  },
): Promise<PassportVerification> {
  const { db } = config;
  const now = config.clock.now();

  return db.transaction(async (tx) => {
    const [next] = await tx
      .update(passportVerifications)
      .set({
        status: "customer_uploaded",
        photoStoragePath: input.storagePath,
        uploadedAt: now,
      })
      .where(eq(passportVerifications.bookingId, input.bookingId))
      .returning();
    if (!next) throw new NotFoundError("Passport verification", input.bookingId);

    await tx.insert(custodyEvents).values({
      bookingId: input.bookingId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      eventType: input.eventType,
      // The custody row carries the STORAGE PATH, exactly like `bag.sealed`.
      // Whoever renders it signs it; nothing here is a URL.
      photoUrl: input.storagePath,
      metadata: {
        storagePath: input.storagePath,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.replacing ? { replacedStoragePath: input.replacing } : {}),
      },
    });
    return next;
  });
}

/*
 * HARDENING BACKLOG (deliberately not in this slice):
 *
 *  - Replacing a photo orphans the previous storage object. Nothing deletes
 *    it, on purpose: a delete here would be an irreversible write triggered by
 *    an ordinary customer retry, and the custody trail already names the
 *    superseded path (`replacedStoragePath`) so an operator can find it. A
 *    retention sweep that removes orphans on a schedule is the right shape,
 *    and it needs a retention policy decided first.
 *  - `status = 'failed'` has no writer yet. The agent's route for "this
 *    passport is wrong" is the existing visit exception (`customer_id_mismatch`),
 *    which raises the booking to `exception` and alerts ops — a stronger action
 *    than a status flip, and already built.
 */
