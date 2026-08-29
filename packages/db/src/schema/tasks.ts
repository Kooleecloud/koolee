import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { taskStatusEnum } from "./enums";
import { bookings } from "./bookings";
import { users } from "./identity";
import { driverShifts } from "./ops";

/**
 * Verification and pickup are modelled as two separate entities even though
 * one person often does both.
 *
 * They have different SLAs, different failure modes, and different evidence
 * requirements — collapsing them into one row would make "verified but not yet
 * collected" unrepresentable. Assigning the same user to both is a dispatch
 * decision, not a schema constraint.
 */

/** Verify ID against the booking, weigh, seal, photograph. */
export const verificationTasks = pgTable(
  "verification_tasks",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: taskStatusEnum("status").notNull().default("pending"),
    scheduledStart: timestamptz("scheduled_start"),
    scheduledEnd: timestamptz("scheduled_end"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One verification task per booking — every reader already assumes it
    // (findFirst / limit 1), and the on-paid auto-assign trigger races by
    // design (webhook + /book/return): this index is what makes the second
    // concurrent insert fail cleanly instead of duplicating the task.
    uniqueIndex("verification_tasks_booking_id_key").on(t.bookingId),
    index("verification_tasks_assignee_status_idx").on(t.assigneeUserId, t.status),
    index("verification_tasks_scheduled_start_idx").on(t.scheduledStart),
  ],
);

/**
 * Collect the sealed bags and drive them to the airline's bag drop.
 *
 * TWO ASSIGNMENT COLUMNS, ON PURPOSE. `driver_shift_id` is the real target —
 * a pickup belongs to a truck-with-a-person-in-it, which is what makes "you
 * cannot end this shift, there are bags in your van" a query. `assignee_user_id`
 * is kept and written in the same statement, holding the shift's staff user,
 * because six existing readers key on it (`getAssignedTask`, `listAssignedTasks`,
 * `agentHasTaskForBooking`, `listAgentBookingIds`, the auto-assign load count,
 * `listAgentWorkload`) and rewriting all six to join through shifts would have
 * been a much larger diff for no behaviour change.
 *
 * They must never disagree. Every write that sets one sets the other; the
 * services in `shifts.ts` and `driver-selection.ts` are the only writers.
 */
export const pickupTasks = pgTable(
  "pickup_tasks",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The shift that owns this pickup. Null until a driver is selected — the
     * on-paid auto-assign creates the row with a verification agent and no
     * shift, and the customer's choice is what fills this in.
     */
    driverShiftId: uuid("driver_shift_id").references(() => driverShifts.id, {
      onDelete: "set null",
    }),
    status: taskStatusEnum("status").notNull().default("pending"),
    scheduledStart: timestamptz("scheduled_start"),
    scheduledEnd: timestamptz("scheduled_end"),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Same one-per-booking rule as verification_tasks (see comment there).
    uniqueIndex("pickup_tasks_booking_id_key").on(t.bookingId),
    index("pickup_tasks_assignee_status_idx").on(t.assigneeUserId, t.status),
    index("pickup_tasks_scheduled_start_idx").on(t.scheduledStart),
    // "What is still open on this shift" — the capacity denominator and the
    // end-of-shift guard both walk it.
    index("pickup_tasks_shift_status_idx").on(t.driverShiftId, t.status),
  ],
);

export type VerificationTask = typeof verificationTasks.$inferSelect;
export type NewVerificationTask = typeof verificationTasks.$inferInsert;
export type PickupTask = typeof pickupTasks.$inferSelect;
export type NewPickupTask = typeof pickupTasks.$inferInsert;
