import { and, eq, gte, lte } from "drizzle-orm";
import { airlineCutoffs, bookings, verificationTasks } from "@koolee/db";
import { subHours } from "date-fns";
import { cron } from "inngest";

import type { CoreConfig } from "../config";
import { minutesUntilCutoff, resolveCutoffMinutes } from "../slots/cutoff";
import { agentNoShowCheck as agentNoShowCheckEvent, bookingConfirmed } from "./client";
import type { KooleeInngest } from "./client";

/**
 * Background jobs.
 *
 * Skeletons with real querying and logging, stubbed side effects. Each is
 * written as a factory taking a `() => CoreConfig` rather than a config value,
 * so the database connection is opened when a run actually happens — not when
 * the module is imported. Importing this file with no credentials must not
 * throw.
 */

export type CoreConfigGetter = () => CoreConfig;

/** One in-transit booking flagged by the cutoff monitor. */
interface AtRiskBooking {
  bookingId: string;
  /** Null when no cutoff is on record, which is itself the problem. */
  minutesRemaining: number | null;
  note: string;
}

/** How long before pickup the reminder goes out. */
const REMINDER_LEAD_HOURS = 2;

/** Grace period after slot start before an agent counts as a no-show. */
const NO_SHOW_GRACE_MINUTES = 15;

/** Cutoff proximity at which ops gets paged about an in-transit booking. */
const CUTOFF_ALERT_THRESHOLD_MINUTES = 60;

export function createKooleeFunctions(
  inngest: KooleeInngest,
  getConfig: CoreConfigGetter,
) {
  /* ------------------------------------------------------------------ */
  /* 1. Pickup reminder                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * On `booking/confirmed`, sleeps until two hours before the pickup window
   * and sends the customer an SMS.
   *
   * `step.sleepUntil` is durable: the run is suspended server-side and resumed
   * at the wall-clock time, so this survives deploys and restarts. A
   * `setTimeout` would not.
   */
  const pickupReminder = inngest.createFunction(
    {
      id: "booking-pickup-reminder",
      name: "Send pickup reminder SMS",
      triggers: [bookingConfirmed],
    },
    async ({ event, step, logger }) => {
      const pickupStartAt = new Date(event.data.pickupStartAt);
      const remindAt = subHours(pickupStartAt, REMINDER_LEAD_HOURS);

      if (remindAt.getTime() > Date.now()) {
        await step.sleepUntil("wait-until-2h-before-pickup", remindAt);
      } else {
        logger.info(
          `Pickup for ${event.data.bookingId} is within ${REMINDER_LEAD_HOURS}h; sending immediately.`,
        );
      }

      return step.run("send-reminder-sms", async () => {
        const config = getConfig();

        // Re-read: the booking may have been cancelled while we slept.
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });

        if (!booking) {
          logger.warn(`Booking ${event.data.bookingId} no longer exists; skipping.`);
          return { sent: false, reason: "booking_missing" };
        }
        if (booking.status === "cancelled") {
          logger.info(`Booking ${booking.id} was cancelled; skipping reminder.`);
          return { sent: false, reason: "cancelled" };
        }

        // TODO(twilio): ConsoleNotifier is the default. Wire the real Twilio
        // implementation and this starts sending for free.
        await config.notifier.sendSms({
          to: event.data.customerPhone,
          body:
            `Koolee: your pickup window starts in ${REMINDER_LEAD_HOURS} hours. ` +
            `Have your ${booking.bagCount} bag(s) and photo ID ready. ` +
            `We'll deliver them to your airline's bag drop.`,
        });

        return { sent: true, bookingId: booking.id };
      });
    },
  );

  /* ------------------------------------------------------------------ */
  /* 2. Cutoff-risk monitor                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Every five minutes, checks in-transit bookings against their bag-drop
   * cutoff and alerts ops on anything that looks tight.
   *
   * Driver ETA is stubbed. The real version compares live vehicle position
   * against a Maps ETA; until then it assumes the configured default drive
   * time, which is optimistic and therefore under-alerts. Noted deliberately:
   * an alert that fires late is worse than one that fires early.
   */
  const cutoffRiskMonitor = inngest.createFunction(
    {
      id: "cutoff-risk-monitor",
      name: "Alert ops on bookings at risk of missing cutoff",
      triggers: [cron("*/5 * * * *")],
    },
    async ({ step, logger }) => {
      const atRisk = await step.run("scan-in-transit-bookings", async () => {
        const config = getConfig();
        const now = config.clock.now();

        const inTransit = await config.db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.status, "in_transit"),
              gte(bookings.departureAt, now),
              lte(bookings.departureAt, new Date(now.getTime() + 24 * 3600_000)),
            ),
          );

        const cutoffRows = await config.db.select().from(airlineCutoffs);

        return inTransit.flatMap<AtRiskBooking>((booking) => {
          let cutoffMinutes: number;
          try {
            cutoffMinutes = resolveCutoffMinutes(
              cutoffRows,
              {
                airlineIata: booking.airlineIata,
                airportCode: booking.departureAirport,
                // TODO: persist scope on the booking. Assuming domestic
                // under-estimates the cutoff for international flights, which
                // errs toward alerting rather than staying quiet.
                scope: "domestic",
              },
              now,
            );
          } catch {
            // No cutoff on record — that is itself worth surfacing.
            return [
              {
                bookingId: booking.id,
                minutesRemaining: null,
                note: "no cutoff on record",
              },
            ];
          }

          // TODO(maps): replace with a live driver ETA from the route.
          const stubDriveMinutes = config.defaults.driveTimeMinutes;
          const remaining =
            minutesUntilCutoff(booking.departureAt, cutoffMinutes, now) -
            stubDriveMinutes;

          return remaining <= CUTOFF_ALERT_THRESHOLD_MINUTES
            ? [{ bookingId: booking.id, minutesRemaining: remaining, note: "tight" }]
            : [];
        });
      });

      if (atRisk.length === 0) {
        logger.info("No in-transit bookings at risk.");
        return { alerted: 0 };
      }

      await step.run("alert-ops", async () => {
        const config = getConfig();
        for (const item of atRisk) {
          await config.opsAlerter.alert({
            severity:
              item.minutesRemaining !== null && item.minutesRemaining < 0
                ? "critical"
                : "warning",
            title: `Booking ${item.bookingId} at risk of missing bag drop`,
            detail: item,
          });
        }
        return { alerted: atRisk.length };
      });

      return { alerted: atRisk.length };
    },
  );

  /* ------------------------------------------------------------------ */
  /* 3. Agent no-show                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Fifteen minutes after a slot starts, checks whether the assigned agent
   * actually began the verification task. If not, escalates to ops.
   */
  const agentNoShowCheck = inngest.createFunction(
    {
      id: "agent-no-show-check",
      name: "Escalate when an agent has not checked in",
      triggers: [agentNoShowCheckEvent],
    },
    async ({ event, step, logger }) => {
      const deadline = new Date(
        new Date(event.data.slotStartAt).getTime() + NO_SHOW_GRACE_MINUTES * 60_000,
      );

      if (deadline.getTime() > Date.now()) {
        await step.sleepUntil("wait-for-grace-period", deadline);
      }

      return step.run("check-and-escalate", async () => {
        const config = getConfig();

        const tasks = await config.db
          .select()
          .from(verificationTasks)
          .where(eq(verificationTasks.bookingId, event.data.bookingId));

        const started = tasks.some(
          (task) => task.startedAt !== null || task.status === "done",
        );

        if (started) {
          logger.info(`Agent checked in for booking ${event.data.bookingId}.`);
          return { escalated: false };
        }

        // TODO(dispatch): reassignment is out of scope for the scaffold. The
        // real handler should try the next available agent before paging a
        // human, and record the attempt in custody_events.
        await config.opsAlerter.alert({
          severity: "critical",
          title: `No agent check-in for booking ${event.data.bookingId}`,
          detail: {
            bookingId: event.data.bookingId,
            assigneeUserId: event.data.assigneeUserId ?? null,
            graceMinutes: NO_SHOW_GRACE_MINUTES,
          },
        });

        return { escalated: true };
      });
    },
  );

  return [pickupReminder, cutoffRiskMonitor, agentNoShowCheck];
}

export type KooleeFunctions = ReturnType<typeof createKooleeFunctions>;
