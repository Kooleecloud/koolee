import { and, eq, gte, lte } from "drizzle-orm";
import { addresses, airlineCutoffs, bookings, users, verificationTasks } from "@koolee/db";
import { subHours } from "date-fns";
import { cron } from "inngest";

import type { CoreConfig } from "../config";
import {
  buildBookingConfirmationEmail,
  buildOpsExceptionEmail,
  buildPickupReminderEmail,
  type PriceLine,
} from "../notifications/emails";
import { resolveDisplayTz } from "../services/display-tz";
import { notifyNewlyCoveredWaitlist } from "../waitlist/notify-covered";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  minutesUntilCutoff,
  resolveCutoffMinutes,
} from "../slots/cutoff";
import {
  agentNoShowCheck as agentNoShowCheckEvent,
  bookingConfirmed,
  exceptionRaised,
} from "./client";
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

export interface KooleeFunctionOptions {
  /**
   * Where `booking/exception_raised` alert emails go. Resolved by the app
   * from OPS_ALERT_EMAIL (core reads no env). Absent → the function logs a
   * skip; the ConsoleOpsAlerter path still fires.
   */
  opsAlertEmail?: string | undefined;
  /** Absolute app origin for trip-page links (NEXT_PUBLIC_APP_URL). */
  appOrigin?: string | undefined;
}

/** Statuses still expecting a pickup — anything else makes a reminder wrong. */
const REMINDER_WORTHY = new Set(["paid", "agent_assigned"]);

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
  options: KooleeFunctionOptions = {},
) {
  const tripUrlFor = (bookingId: string): string | undefined =>
    options.appOrigin ? `${options.appOrigin.replace(/\/$/, "")}/trips/${bookingId}` : undefined;

  /* ------------------------------------------------------------------ */
  /* 0. Booking confirmation email                                       */
  /* ------------------------------------------------------------------ */

  /**
   * On `booking/confirmed`, emails the customer the full confirmation:
   * booking ref (`bookings.ref`, KOO-XXXXX), flight, pickup window (BOOKING's
   * tz with abbreviation — docs/TIME.md), address, bags, price breakdown,
   * trip link.
   *
   * Idempotency: senders emit the event with id `booking-confirmed:<id>`, so
   * the webhook/return-page race collapses to ONE event, and Inngest's step
   * memoization means a retried run never re-sends a step that succeeded.
   * A failed send is logged + ops-alerted, never thrown — the booking flow
   * must not (and cannot, being async) fail on email.
   */
  const bookingConfirmationEmail = inngest.createFunction(
    {
      id: "booking-confirmation-email",
      name: "Send booking confirmation email",
      triggers: [bookingConfirmed],
    },
    async ({ event, step, logger }) => {
      return step.run("send-confirmation-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };
        if (booking.status === "cancelled") return { sent: false, reason: "cancelled" };

        const customer = await config.db.query.users.findFirst({
          where: eq(users.id, booking.userId),
          columns: { email: true },
        });
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        const address = await config.db.query.addresses.findFirst({
          where: eq(addresses.id, booking.pickupAddressId),
        });
        const tz = await resolveDisplayTz(config.db, booking.departureAirport);
        const windowLabel =
          booking.pickupWindowStart && booking.pickupWindowEnd
            ? formatWindowInAirportTz(booking.pickupWindowStart, booking.pickupWindowEnd, tz)
            : "see your trip page";

        // The breakdown persisted at booking time is the truth of what was
        // charged — never recompute it here (prices may have changed since).
        const bd = booking.priceBreakdown;
        const priceLines: PriceLine[] = bd
          ? [
              { label: "Base fee", amountCents: bd.baseFeeCents },
              { label: "Bags", amountCents: bd.bagsCents },
              { label: "Distance", amountCents: bd.distanceCents },
              ...(bd.leadTimeAdjustmentCents !== 0
                ? [{ label: "Lead-time adjustment", amountCents: bd.leadTimeAdjustmentCents }]
                : []),
              ...bd.discounts.map((d) => ({ label: d.label, amountCents: -d.amountCents })),
            ]
          : [];

        const message = buildBookingConfirmationEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          flightNumber: booking.flightNumber,
          departureAirport: booking.departureAirport,
          windowLabel,
          departureLabel: formatInstantInAirportTz(booking.departureAt, tz),
          addressLine: address
            ? `${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.state} ${address.zip}`
            : "your saved pickup address",
          bagCount: booking.bagCount,
          priceLines,
          totalCents: bd?.totalCents ?? 0,
          ...(tripUrlFor(booking.id) === undefined
            ? {}
            : { tripUrl: tripUrlFor(booking.id)! }),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "warning",
            title: `Confirmation email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id };
      });
    },
  );

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

      const sms = await step.run("send-reminder-sms", async () => {
        const config = getConfig();

        // Re-read: the booking may have moved on while we slept. Anything
        // past `agent_assigned` (or cancelled/exception) is no longer
        // reminder-worthy — the visit is already happening or never will.
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });

        if (!booking) {
          logger.warn(`Booking ${event.data.bookingId} no longer exists; skipping.`);
          return { sent: false, reason: "booking_missing" };
        }
        if (!REMINDER_WORTHY.has(booking.status)) {
          logger.info(`Booking ${booking.id} is ${booking.status}; skipping reminder.`);
          return { sent: false, reason: `status_${booking.status}` };
        }

        // TODO(notifications): SMS stays on the console fallback until the
        // Twilio work item. Wiring the real adapter changes nothing here.
        await config.notifier.sendSms({
          to: event.data.customerPhone,
          body:
            `Koolee: your pickup window starts in ${REMINDER_LEAD_HOURS} hours. ` +
            `Have your ${booking.bagCount} bag(s) and photo ID ready. ` +
            `We'll deliver them to your airline's bag drop.`,
        });

        return { sent: true, bookingId: booking.id };
      });

      const email = await step.run("send-reminder-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking || !REMINDER_WORTHY.has(booking.status)) {
          return { sent: false, reason: "not_reminder_worthy" };
        }

        const customer = await config.db.query.users.findFirst({
          where: eq(users.id, booking.userId),
          columns: { email: true },
        });
        if (!customer?.email) return { sent: false, reason: "no_email" };

        const tz = await resolveDisplayTz(config.db, booking.departureAirport);
        const message = buildPickupReminderEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          windowLabel:
            booking.pickupWindowStart && booking.pickupWindowEnd
              ? formatWindowInAirportTz(booking.pickupWindowStart, booking.pickupWindowEnd, tz)
              : "soon — see your trip page",
          bagCount: booking.bagCount,
          ...(tripUrlFor(booking.id) === undefined
            ? {}
            : { tripUrl: tripUrlFor(booking.id)! }),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "warning",
            title: `Reminder email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true };
      });

      return { sms, email };
    },
  );

  /* ------------------------------------------------------------------ */
  /* 1b. Exception ops alert email                                       */
  /* ------------------------------------------------------------------ */

  /**
   * On `booking/exception_raised`, emails the ops inbox. The address comes in
   * via options (OPS_ALERT_EMAIL) — unset means log-and-skip, and the
   * ConsoleOpsAlerter/board paths still surface the exception.
   */
  const exceptionOpsAlertEmail = inngest.createFunction(
    {
      id: "exception-ops-alert-email",
      name: "Email ops when a booking enters exception",
      triggers: [exceptionRaised],
    },
    async ({ event, step, logger }) => {
      return step.run("send-ops-alert-email", async () => {
        const to = options.opsAlertEmail;
        if (!to) {
          logger.info("OPS_ALERT_EMAIL not configured; skipping exception email.");
          return { sent: false, reason: "no_ops_email" };
        }

        const config = getConfig();

        // Best-effort: the event payload carries no ref (its shape is fixed),
        // so look it up. A missing row must not stop the alert — ops needs to
        // hear about the exception either way.
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { ref: true },
        });

        const message = buildOpsExceptionEmail({
          to,
          bookingId: event.data.bookingId,
          ...(booking?.ref === undefined ? {} : { bookingRef: booking.ref }),
          reason: event.data.reason,
          raisedByUserId: event.data.raisedByUserId,
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "critical",
            title: `Exception email failed for booking ${event.data.bookingId}`,
            detail: { bookingId: event.data.bookingId, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true };
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

  /* ------------------------------------------------------------------ */
  /* 4. Waitlist zone-opened sweep                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Daily reconciler for the waitlist's promised email. Coverage lives in
   * code, so "a zone opened" is a deploy — this sweep converges on it within
   * a day: unnotified signups whose ZIP is covered NOW get the email and a
   * `notified_at` stamp (see notifyNewlyCoveredWaitlist for the idempotency
   * contract). Quiet when there is nothing to do, which is almost always.
   */
  const waitlistZoneOpenedSweep = inngest.createFunction(
    {
      id: "waitlist-zone-opened-sweep",
      name: "Email waitlist signups whose ZIP gained coverage",
      triggers: [cron("TZ=America/New_York 0 10 * * *")],
    },
    async ({ step, logger }) => {
      return step.run("notify-newly-covered", async () => {
        const result = await notifyNewlyCoveredWaitlist(getConfig(), {
          appOrigin: options.appOrigin,
        });
        if (result.notified > 0 || result.failed > 0) {
          logger.info(
            `waitlist sweep: notified ${result.notified}, failed ${result.failed}, still uncovered ${result.stillUncovered}`,
          );
        }
        return result;
      });
    },
  );

  return [
    bookingConfirmationEmail,
    pickupReminder,
    exceptionOpsAlertEmail,
    waitlistZoneOpenedSweep,
    cutoffRiskMonitor,
    agentNoShowCheck,
  ];
}

export type KooleeFunctions = ReturnType<typeof createKooleeFunctions>;
