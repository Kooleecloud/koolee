import {
  BUCKETS,
  getBookingActionability,
  getCancellation,
  getPickupContext,
  getVisitContext,
  listAssignedTasks,
  pickupCoordinates,
  staffTravelToDoor,
  type PickupContext,
  type VisitContext,
} from "@koolee/core";
import {
  agreementAcceptanceSchema,
  agreementVersionSchema,
  bagSchema,
  bookingSchema,
  custodyEventSchema,
  passportVerificationSchema,
  pickupTaskSchema,
  taskBookingContextSchema,
  verificationTaskSchema,
  type AssignedTasksResponse,
  type PickupDetail,
  type TaskDetailResponse,
  type TaskKind,
  type VisitDetail,
} from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { toJson, type Jsonified } from "../json";
import { signUrl } from "../storage";

/**
 * Task reads — the list and the detail screen — mirroring what
 * `app/tasks/[taskId]/page.tsx` assembles for the web. The app groups the
 * list into Today / Schedule / History itself, so the list is the raw
 * assignment, and the detail is everything the page derives its views from
 * (the app derives the same views from the same fields).
 *
 * EVERY ROW IS PROJECTED BEFORE IT LEAVES. Core hands back whole database
 * rows, and a booking row carries the price and its breakdown, an agreement
 * acceptance carries the customer's IP and user agent, an agreement version
 * carries the entire legal text. The page never sends any of that to a
 * phone — it builds narrow views — and neither does this: each row is cut
 * down to the columns the contract declares, so what crosses the wire is
 * exactly what the app will keep. The app's zod stripping is a guard for a
 * column added later, not the mechanism that keeps pricing off a driver's
 * device.
 */

export async function readTasks(ctx: ApiContext): Promise<AssignedTasksResponse> {
  const assigned = await listAssignedTasks(ctx.core.db, ctx.session.userId, ctx.now);
  return {
    verification: assigned.verification.map((row) => ({
      task: project(row.task, VERIFICATION_TASK_KEYS),
      tz: row.tz,
      booking: project(row.booking, TASK_BOOKING_KEYS),
    })),
    pickup: assigned.pickup.map((row) => ({
      task: project(row.task, PICKUP_TASK_KEYS),
      tz: row.tz,
      booking: project(row.booking, TASK_BOOKING_KEYS),
    })),
    serverTime: ctx.now.toISOString(),
  };
}

export async function readTaskDetail(
  ctx: ApiContext,
  taskId: string,
  kind: TaskKind,
): Promise<TaskDetailResponse> {
  if (kind === "pickup") {
    const context = await getPickupContext(ctx.core.db, ctx.session, taskId);
    return { kind: "pickup", pickup: await assemblePickupDetail(ctx, context) };
  }
  const context = await getVisitContext(ctx.core.db, ctx.session, taskId, ctx.now);
  return { kind: "verification", visit: await assembleVisitDetail(ctx, context) };
}

type DetailCommon = Omit<
  VisitDetail,
  "task" | "paymentStatus" | "identityGate" | "passportPhotoUrl"
>;

/**
 * The half of the detail both kinds share: the doorstep, who is behind it,
 * whether the job is still a job, and how far away it is. The page reads
 * these one after another; here they go out together, and the cancellation
 * lookup hangs off the actionability answer rather than waiting for the
 * whole batch — it is only ever asked of a terminal booking.
 */
async function assembleCommon(
  ctx: ApiContext,
  context: VisitContext | PickupContext,
): Promise<DetailCommon> {
  const { booking } = context;
  const actionabilityPromise = getBookingActionability(ctx.core.db, booking, ctx.now);
  const [actionability, cancellation, travel, customerAvatarUrl] = await Promise.all([
    actionabilityPromise,
    actionabilityPromise.then((state) =>
      state.standing === "terminal" ? getCancellation(ctx.core.db, booking.id) : null,
    ),
    staffTravelToDoor(ctx.core, {
      staffUserId: ctx.session.userId,
      destination: pickupCoordinates(context.address),
    }),
    signUrl(
      ctx.supabase,
      BUCKETS.avatars.id,
      context.customer?.avatarStoragePath,
      BUCKETS.avatars.signedUrlTtlSeconds,
    ),
  ]);

  return {
    booking: project(booking, BOOKING_KEYS),
    bags: context.bags.map((bag) => project(bag, BAG_KEYS)),
    timeline: context.timeline.map((event) => project(event, CUSTODY_EVENT_KEYS)),
    tz: context.tz,
    address: context.address,
    customer: context.customer,
    customerAvatarUrl,
    actionability: toJson(actionability),
    travel,
    cancellation: cancellation ? toJson(cancellation) : null,
    serverTime: ctx.now.toISOString(),
  };
}

async function assembleVisitDetail(
  ctx: ApiContext,
  context: VisitContext,
): Promise<VisitDetail> {
  // Signed as the calling agent with the short passport TTL: the URL is a
  // bearer credential for a photo of somebody's passport, and the app
  // refetches the detail rather than caching it.
  const [common, passportPhotoUrl] = await Promise.all([
    assembleCommon(ctx, context),
    signUrl(
      ctx.supabase,
      BUCKETS.passportPhotos.id,
      context.identityGate.passport?.photoStoragePath,
      BUCKETS.passportPhotos.signedUrlTtlSeconds,
    ),
  ]);
  const { identityGate } = context;
  return {
    ...common,
    task: project(context.task, VERIFICATION_TASK_KEYS),
    paymentStatus: context.paymentStatus,
    identityGate: {
      agreement: {
        acceptedVersion: projectNullable(
          identityGate.agreement.acceptedVersion,
          AGREEMENT_VERSION_KEYS,
        ),
        acceptance: projectNullable(
          identityGate.agreement.acceptance,
          AGREEMENT_ACCEPTANCE_KEYS,
        ),
        currentVersion: projectNullable(
          identityGate.agreement.currentVersion,
          AGREEMENT_VERSION_KEYS,
        ),
        accepted: identityGate.agreement.accepted,
      },
      passport: projectNullable(identityGate.passport, PASSPORT_KEYS),
      passportConfirmed: identityGate.passportConfirmed,
      blockers: identityGate.blockers,
      passed: identityGate.passed,
    },
    passportPhotoUrl,
  };
}

async function assemblePickupDetail(
  ctx: ApiContext,
  context: PickupContext,
): Promise<PickupDetail> {
  const common = await assembleCommon(ctx, context);
  return {
    ...common,
    task: project(context.task, PICKUP_TASK_KEYS),
    scannedBagIds: context.scannedBagIds,
    shift: context.shift,
  };
}

/* ------------------------------------------------------------------ */
/* Projection                                                           */
/* ------------------------------------------------------------------ */

/**
 * The column lists come from the contract schemas themselves, so the wire
 * shape and the app's parser can never disagree about which columns exist:
 * add a field to the schema and it is sent; leave it out and it is not.
 * `tsc` checks the other direction — a schema key the row does not carry
 * fails to compile in `project`'s constraint.
 */
function keysOf<T extends object>(schema: { shape: Record<keyof T, unknown> }) {
  return Object.keys(schema.shape) as (keyof T)[];
}

const BOOKING_KEYS = keysOf<VisitDetail["booking"]>(bookingSchema);
const BAG_KEYS = keysOf<VisitDetail["bags"][number]>(bagSchema);
const CUSTODY_EVENT_KEYS = keysOf<VisitDetail["timeline"][number]>(custodyEventSchema);
const VERIFICATION_TASK_KEYS = keysOf<VisitDetail["task"]>(verificationTaskSchema);
const PICKUP_TASK_KEYS = keysOf<PickupDetail["task"]>(pickupTaskSchema);
const TASK_BOOKING_KEYS = keysOf<
  AssignedTasksResponse["verification"][number]["booking"]
>(taskBookingContextSchema);
const AGREEMENT_VERSION_KEYS =
  keysOf<NonNullable<VisitDetail["identityGate"]["agreement"]["acceptedVersion"]>>(
    agreementVersionSchema,
  );
const AGREEMENT_ACCEPTANCE_KEYS = keysOf<
  NonNullable<VisitDetail["identityGate"]["agreement"]["acceptance"]>
>(agreementAcceptanceSchema);
const PASSPORT_KEYS = keysOf<NonNullable<VisitDetail["identityGate"]["passport"]>>(
  passportVerificationSchema,
);

/** The declared columns of one row, dates as ISO strings, nothing else. */
function project<TRow extends Record<K, unknown>, K extends keyof TRow>(
  row: TRow,
  keys: readonly K[],
): Jsonified<Pick<TRow, K>> {
  const picked = {} as Pick<TRow, K>;
  for (const key of keys) picked[key] = row[key];
  return toJson(picked);
}

function projectNullable<TRow extends Record<K, unknown>, K extends keyof TRow>(
  row: TRow | null,
  keys: readonly K[],
): Jsonified<Pick<TRow, K>> | null {
  return row === null ? null : project(row, keys);
}
