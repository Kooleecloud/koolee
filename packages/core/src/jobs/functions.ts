import { and, eq, gte, lte } from "drizzle-orm";
import {
  airlineCutoffs,
  airports,
  bags,
  bookings,
  pickupTasks,
  users,
  verificationTasks,
} from "@koolee/db";
import { subHours } from "date-fns";
import { cron } from "inngest";

import type { CoreConfig } from "../config";
import {
  buildAgentAssignedEmail,
  buildBagdropDeliveredEmail,
  buildBagsSealedEmail,
  buildCustomerExceptionEmail,
  buildDriverSelectedEmail,
  buildOpsDriverPoolEmptyEmail,
  buildOpsExceptionEmail,
  buildPickupReminderEmail,
} from "../notifications/emails";
import {
  adminBookingUrlFor as buildAdminBookingUrl,
  taskUrlFor as buildTaskUrl,
  tripUrlFor as buildTripUrl,
} from "../notifications/links";
import { toCoordinates, type Coordinates } from "../geo/coordinates";
import type { EtaEstimatorKind } from "../geo/eta";
import { assignEnteringHorizon } from "../services/auto-assign";
import {
  listAdminPushTargets,
  pushToTargets,
  pushToUsers,
} from "../services/push-subscriptions";
import { assembleBookingConfirmationEmail } from "../services/confirmation-email";
import { resolveDisplayTz } from "../services/display-tz";
import { notifyNewlyCoveredWaitlist } from "../waitlist/notify-covered";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  minutesUntilCutoff,
  resolveStrictestCutoffMinutes,
} from "../slots/cutoff";
import {
  agentAssigned as agentAssignedEvent,
  agentNoShowCheck as agentNoShowCheckEvent,
  bagsSealed as bagsSealedEvent,
  bookingConfirmed,
  deliveredToBagdrop as deliveredToBagdropEvent,
  driverPoolEmpty as driverPoolEmptyEvent,
  driverSelected as driverSelectedEvent,
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
  /**
   * Absolute origins of the two STAFF apps, for push deep links only.
   *
   * A notification that cannot be tapped through to the thing it is about is
   * half a notification — an agent reading "new visit assigned" on a phone
   * has to find it by hand. Absent → the push still goes, without a link,
   * because the notification is worth more than the link (`notificationclick`
   * falls back to `/`).
   */
  agentAppOrigin?: string | undefined;
  adminAppOrigin?: string | undefined;
  /**
   * The address a customer may write to when something has gone wrong.
   *
   * Passed in rather than read from an env var because it is not
   * per-environment configuration — it is public site copy that already lives
   * in `apps/web/src/lib/site.ts`, and core reads no env either way. Absent →
   * the customer-facing exception email is skipped rather than sent with a
   * placeholder address nobody monitors.
   */
  supportEmail?: string | undefined;
}

/** Statuses still expecting a pickup — anything else makes a reminder wrong. */
const REMINDER_WORTHY = new Set(["paid", "agent_assigned"]);

/** One in-transit booking flagged by the cutoff monitor. */
interface AtRiskBooking {
  bookingId: string;
  /** Null when no cutoff is on record, which is itself the problem. */
  minutesRemaining: number | null;
  note: string;
  /** Where the drive-time number came from, so an alert is auditable. */
  driveMinutes?: number;
  driveSource?: "estimator" | "configured_default";
  /** Which estimator was CONFIGURED — see the note at the call site. */
  estimatorKind?: EtaEstimatorKind;
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
    buildTripUrl(options.appOrigin, bookingId);
  const taskUrlFor = (taskId: string): string | undefined =>
    buildTaskUrl(options.agentAppOrigin, taskId);
  const adminBookingUrlFor = (bookingId: string): string | undefined =>
    buildAdminBookingUrl(options.adminAppOrigin, bookingId);

  /* ------------------------------------------------------------------ */
  /* Push fan-out                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * PUSH IS NEVER LOAD-BEARING (§7). Every send below sits in its OWN
   * `step.run`, after the email step and never inside it, for three reasons:
   *
   *  1. the email is the guaranteed channel and must complete first;
   *  2. Inngest memoizes steps independently, so a retried email step does
   *     not re-send the push and a retried push does not re-send the email;
   *  3. the function's return value stays the email's result, so nothing
   *     downstream — or in the existing tests — learns a new shape.
   *
   * `pushToUsers` / `pushToTargets` never throw, so a dead push provider
   * cannot fail a step either way. The belt and the braces are both here on
   * purpose: this is the channel that fails silently.
   */

  /** Spreads `url` only when there is one — the payload has no empty keys. */
  const withUrl = (url: string | undefined) => (url === undefined ? {} : { url });

  /**
   * One notification per booking, replaced as the booking moves on.
   *
   * A stable tag means "your agent is Nina" is REPLACED by "your bags are
   * sealed" rather than stacking beside it: the customer's lock screen shows
   * where their bags are now, not a history of where they have been.
   * `renotify` is what makes the replacement re-alert instead of landing in
   * silence.
   */
  const customerTag = (bookingId: string) => `booking:${bookingId}`;

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

        // Same assembler the guest-adds-email path uses — one builder, two
        // dispatch points (services/confirmation-email.ts).
        const message = await assembleBookingConfirmationEmail(config, {
          booking,
          to: customer.email,
          appOrigin: options.appOrigin,
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
            `Have your ${booking.bagCount} bag(s) and passport ready, and accept our ` +
            `booking agreement on your trip page if you haven't. ` +
            `We'll deliver your bags to your airline's bag drop.`,
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
              ? formatWindowInAirportTz(
                  booking.pickupWindowStart,
                  booking.pickupWindowEnd,
                  tz,
                )
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
      const emailResult = await step.run("send-ops-alert-email", async () => {
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

      /*
       * Ops, on whatever machine they are actually at.
       *
       * The audience is DERIVED — every active admin who has a subscription
       * (`listAdminPushTargets`), no roster to keep in step with anything.
       * Unlike the email, this does NOT depend on OPS_ALERT_EMAIL: it is a
       * different channel to different people, and an unset inbox address is
       * no reason to leave everyone's phone silent.
       *
       * UNIQUE TAG. Two bookings in exception are two problems, and a
       * collapsed notification would hide the second one entirely — the exact
       * failure mode this alert exists to prevent.
       */
      await step.run("push-exception-ops", async () => {
        const config = getConfig();
        const targets = await listAdminPushTargets(config.db);
        if (targets.length === 0) return { skipped: "no_admin_subscriptions" };

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { ref: true },
        });

        return pushToTargets(
          config,
          targets,
          {
            title: "Booking in exception",
            body: `${booking?.ref ?? event.data.bookingId} · ${event.data.reason}`,
            tag: `exception:${event.data.bookingId}:${config.clock.now().getTime()}`,
            ...withUrl(adminBookingUrlFor(event.data.bookingId)),
          },
          { urgency: "high" },
        );
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 2. Cutoff-risk monitor                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Every five minutes, checks in-transit bookings against their bag-drop
   * cutoff and alerts ops on anything that looks tight.
   *
   * Two things it used to get wrong, both fixed in the driver/pickup slice
   * and both in the direction of staying quiet — the worst direction for an
   * alert:
   *
   *  1. It assumed `scope: "domestic"` for every booking. Bookings do not
   *     persist a scope, and domestic is the LOOSER of the two seeded cutoffs,
   *     so international flights were measured against a deadline 15 minutes
   *     later than the real one. It now takes the strictest row on record for
   *     the airline and airport, whichever scope it belongs to.
   *  2. It subtracted a flat `defaults.driveTimeMinutes`. It now asks the
   *     `etaEstimator` seam for a real pickup-address → airport estimate
   *     wherever both ends have coordinates, and takes the pessimistic end of
   *     the range. The configured default remains the fallback for an address
   *     whose ZIP has no centroid.
   *
   * Still stubbed: the drive is measured from the PICKUP ADDRESS, not from
   * where the driver actually is. `driver_positions` holds a live latest
   * position and wiring it in here is the obvious next step; it is left out
   * so this function keeps working for a booking whose driver has GPS off.
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

        // The far end of the drive, loaded wholesale rather than joined. Same
        // reasoning as `cutoffRows`: `airports` is three rows. The near end no
        // longer needs loading at all — since 0033 the doorstep is on the
        // booking, so the whole `addresses` scan and its id map are gone.
        const [cutoffRows, airportRows] = await Promise.all([
          config.db.select().from(airlineCutoffs),
          config.db.select().from(airports),
        ]);
        const airportByCode = new Map(airportRows.map((a) => [a.code, a]));

        /* First pass, no I/O: the cutoff, and whether this booking has two
           ends to measure between. Bookings with no cutoff on record leave
           here — that absence IS the alert. */
        const noCutoff: AtRiskBooking[] = [];
        const measurable: {
          booking: (typeof inTransit)[number];
          cutoffMinutes: number;
          from: Coordinates | null;
          to: Coordinates | null;
        }[] = [];

        for (const booking of inTransit) {
          let cutoffMinutes: number;
          try {
            // The STRICTEST cutoff across both scopes, not an assumed
            // `domestic`. Bookings do not persist domestic/international, and
            // the old assumption picked the looser of the two rows — so an
            // international flight was measured against a deadline 15 minutes
            // later than the real one and the alert stayed quiet.
            cutoffMinutes = resolveStrictestCutoffMinutes(
              cutoffRows,
              {
                airlineIata: booking.airlineIata,
                airportCode: booking.departureAirport,
              },
              now,
            );
          } catch {
            // No cutoff on record — that is itself worth surfacing.
            noCutoff.push({
              bookingId: booking.id,
              minutesRemaining: null,
              note: "no cutoff on record",
            });
            continue;
          }

          const airport = airportByCode.get(booking.departureAirport);
          measurable.push({
            booking,
            cutoffMinutes,
            from: toCoordinates(booking.pickupLat, booking.pickupLng),
            to: toCoordinates(airport?.lat, airport?.lng),
          });
        }

        /* Second pass: the estimator, ONE CALL PER AIRPORT rather than one per
           booking. `estimate` became async in Tier 5 so a routing provider
           could sit behind the seam, and this is a cron that fans out over
           every in-transit booking — awaiting inside the loop would have made
           a five-minute job into N serial round-trips against a third party.
           There are three airports, so this is at most three calls however
           many bookings are moving. */
        const byAirport = new Map<string, { index: number; from: Coordinates }[]>();
        for (const [index, item] of measurable.entries()) {
          if (item.from === null || item.to === null) continue;
          const group = byAirport.get(item.booking.departureAirport);
          if (group) group.push({ index, from: item.from });
          else byAirport.set(item.booking.departureAirport, [{ index, from: item.from }]);
        }

        const estimatedMaxMinutes = new Array<number | null>(measurable.length).fill(
          null,
        );
        await Promise.all(
          [...byAirport.values()].map(async (group) => {
            const to = measurable[group[0]!.index]!.to;
            if (to === null) return;
            const ranges = await config.etaEstimator.estimateMany({
              from: group.map((g) => g.from),
              to,
            });
            group.forEach((g, i) => {
              // `maxMinutes` rather than the midpoint on purpose: this is an
              // alert, and the pessimistic end is the one that fires early.
              const range = ranges[i];
              if (range) estimatedMaxMinutes[g.index] = range.maxMinutes;
            });
          }),
        );

        /* Third pass: the arithmetic. The configured default only where there
           was nothing to measure between (an address whose ZIP has no
           centroid). */
        const tight = measurable.flatMap<AtRiskBooking>((item, index) => {
          const estimated = estimatedMaxMinutes[index] ?? null;
          const driveMinutes = estimated ?? config.defaults.driveTimeMinutes;

          const remaining =
            minutesUntilCutoff(item.booking.departureAt, item.cutoffMinutes, now) -
            driveMinutes;

          return remaining <= CUTOFF_ALERT_THRESHOLD_MINUTES
            ? [
                {
                  bookingId: item.booking.id,
                  minutesRemaining: remaining,
                  note: "tight",
                  driveMinutes,
                  driveSource:
                    estimated === null
                      ? ("configured_default" as const)
                      : ("estimator" as const),
                  // WHICH estimator was configured — not which one answered.
                  // `GoogleRoutesEtaEstimator` falls back to haversine per
                  // call and logs when it does; this tag stays "google-routes"
                  // either way, so read it as configuration.
                  estimatorKind: config.etaEstimator.kind,
                },
              ]
            : [];
        });

        return [...noCutoff, ...tight];
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

  /* ------------------------------------------------------------------ */
  /* 5. Driver selected — customer email                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Registered HERE, in core's shared factory, not in the app that raises it.
   * The agent app's Inngest client is SEND-ONLY by design (it serves no
   * `/api/inngest` route); a function added there would silently never run.
   * `apps/web` owns the registry and serves every one of these.
   */
  const driverSelectedEmail = inngest.createFunction(
    {
      id: "driver-selected-email",
      name: "Tell the customer which driver is on their pickup",
      triggers: [driverSelectedEvent],
    },
    async ({ event, step, logger }) => {
      const emailResult = await step.run("send-driver-selected-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };
        if (booking.status === "cancelled") return { sent: false, reason: "cancelled" };

        const [customer, driver] = await Promise.all([
          config.db.query.users.findFirst({
            where: eq(users.id, booking.userId),
            columns: { email: true },
          }),
          config.db.query.users.findFirst({
            where: eq(users.id, event.data.driverUserId),
            columns: { fullName: true },
          }),
        ]);
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        const message = buildDriverSelectedEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          driverGivenName: driver?.fullName?.trim().split(/\s+/)[0] ?? null,
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
            title: `Driver-selected email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id };
      });

      /*
       * TWO AUDIENCES AGAIN. The customer gets the milestone (collapsing onto
       * the booking's one notification); the driver gets a JOB, which stacks,
       * because a second pickup on the same shift is a second van stop and a
       * replaced notification would be a booking nobody knows they hold.
       *
       * `driverUserId` is the shift's staff user — `selectDriver` writes both
       * assignment columns in one statement, so the two cannot disagree.
       */
      await step.run("push-driver-selected", async () => {
        const config = getConfig();
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { id: true, ref: true, userId: true, bagCount: true, status: true },
        });
        if (!booking) return { skipped: "booking_missing" };
        if (booking.status === "cancelled") return { skipped: "cancelled" };

        const driver = await config.db.query.users.findFirst({
          where: eq(users.id, event.data.driverUserId),
          columns: { fullName: true },
        });
        const driverGivenName = driver?.fullName?.trim().split(/\s+/)[0] ?? null;

        const customer = await pushToUsers(
          config,
          [booking.userId],
          {
            title: driverGivenName
              ? `${driverGivenName} is collecting your bags`
              : "Your driver is on the way",
            body: `${booking.ref} · follow the pickup on your trip page.`,
            tag: customerTag(booking.id),
            renotify: true,
            ...withUrl(tripUrlFor(booking.id)),
          },
          { urgency: "normal" },
        );

        const task = await config.db.query.pickupTasks.findFirst({
          where: eq(pickupTasks.bookingId, booking.id),
          columns: { id: true },
        });
        const driverPush = await pushToUsers(
          config,
          [event.data.driverUserId],
          {
            title: "New pickup on your shift",
            body: `${booking.ref} · ${booking.bagCount} ${booking.bagCount === 1 ? "bag" : "bags"}.`,
            tag: task ? `pickup-task:${task.id}` : `pickup:${booking.id}`,
            ...withUrl(task ? taskUrlFor(task.id) : undefined),
          },
          { urgency: "high" },
        );

        return { customer, driver: driverPush };
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 6. Delivered to the bag drop — customer email                        */
  /* ------------------------------------------------------------------ */

  const bagdropDeliveredEmail = inngest.createFunction(
    {
      id: "bagdrop-delivered-email",
      name: "Tell the customer their bags reached the bag drop",
      triggers: [deliveredToBagdropEvent],
    },
    async ({ event, step, logger }) => {
      const emailResult = await step.run("send-bagdrop-delivered-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };

        const customer = await config.db.query.users.findFirst({
          where: eq(users.id, booking.userId),
          columns: { email: true },
        });
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        const message = buildBagdropDeliveredEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          flightNumber: booking.flightNumber,
          departureAirport: booking.departureAirport,
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
            title: `Bag-drop delivered email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id };
      });

      /* The last thing the customer hears, and the one they were waiting for. */
      await step.run("push-bagdrop-delivered", async () => {
        const config = getConfig();
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: {
            id: true,
            ref: true,
            userId: true,
            flightNumber: true,
            departureAirport: true,
          },
        });
        if (!booking) return { skipped: "booking_missing" };

        return pushToUsers(
          config,
          [booking.userId],
          {
            title: "Your bags are at the bag drop",
            // Copy rule: delivered TO the airline's bag drop. Never "checked
            // in" — Koolee does not check anybody in.
            body:
              `${booking.ref} · handed to ${booking.flightNumber} at ` +
              `${booking.departureAirport}. Check in as usual.`,
            tag: customerTag(booking.id),
            renotify: true,
            ...withUrl(tripUrlFor(booking.id)),
          },
          { urgency: "normal" },
        );
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 7. No driver available — ops alert                                   */
  /* ------------------------------------------------------------------ */

  /**
   * A sealed booking was shown to a customer and there was nothing to offer.
   *
   * Not routed through the exception queue: the booking is fine, the roster is
   * not, and an exception is resolved by a human who cannot fix staffing from
   * that screen. Throttling is the EVENT ID (bucketed by hour in
   * `emitDriverPoolEmpty`), so this handler has no rate limiting of its own —
   * a repeated id never reaches it.
   */
  const driverPoolEmptyOpsAlert = inngest.createFunction(
    {
      id: "driver-pool-empty-ops-alert",
      name: "Alert ops when no driver can be offered",
      triggers: [driverPoolEmptyEvent],
    },
    async ({ event, step, logger }) => {
      const emailResult = await step.run("alert-ops-no-driver", async () => {
        const config = getConfig();

        // The console alerter always fires; the email is the upgrade, and it
        // needs an address the app resolved from OPS_ALERT_EMAIL.
        await config.opsAlerter.alert({
          severity: "warning",
          title: `No driver available for booking ${event.data.bookingId}`,
          detail: event.data,
        });

        if (!options.opsAlertEmail) {
          logger.info("OPS_ALERT_EMAIL not configured; console alert only.");
          return { sent: false, reason: "no_ops_email" };
        }

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        const tz = booking
          ? await resolveDisplayTz(config.db, booking.departureAirport)
          : null;

        const message = buildOpsDriverPoolEmptyEmail({
          to: options.opsAlertEmail,
          bookingId: event.data.bookingId,
          bookingRef: booking?.ref,
          zip: event.data.zip,
          bagCount: event.data.bagCount,
          ...(booking && tz
            ? { departureLabel: formatInstantInAirportTz(booking.departureAt, tz) }
            : {}),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "critical",
            title: `No-driver alert email failed for booking ${event.data.bookingId}`,
            detail: { error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true };
      });

      /*
       * STABLE TAG + renotify, unlike the exception above: this is one
       * booking with a staffing problem that will keep being raised until
       * somebody rosters a driver. Stacking would bury the console under
       * repeats of the same fact; collapsing keeps ONE live alert per booking
       * that re-alerts each time it recurs. (The event id is already bucketed
       * by hour in `emitDriverPoolEmpty`, so "each time" is at most hourly.)
       */
      await step.run("push-driver-pool-empty", async () => {
        const config = getConfig();
        const targets = await listAdminPushTargets(config.db);
        if (targets.length === 0) return { skipped: "no_admin_subscriptions" };

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { ref: true },
        });

        return pushToTargets(
          config,
          targets,
          {
            title: "No driver for a sealed booking",
            body:
              `${booking?.ref ?? event.data.bookingId} · ZIP ${event.data.zip} · ` +
              `${event.data.bagCount} ${event.data.bagCount === 1 ? "bag" : "bags"}.`,
            tag: `driver-pool-empty:${event.data.bookingId}`,
            renotify: true,
            ...withUrl(adminBookingUrlFor(event.data.bookingId)),
          },
          { urgency: "high" },
        );
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 8. "Your agent is <name>"                                           */
  /* ------------------------------------------------------------------ */

  /**
   * The first message after confirmation that names a person.
   *
   * Before this the customer learned who was coming only by opening the trip
   * page, which nothing prompted them to do between the confirmation email
   * and the two-hour reminder. Auto-assign usually fires within seconds of
   * payment, so in practice this arrives right behind the confirmation and
   * turns "somebody will collect your bags" into "Nina will".
   *
   * Skipped for a booking that is no longer live: a reassignment on a
   * cancelled booking is an ops correction, not news for the customer.
   */
  const agentAssignedEmail = inngest.createFunction(
    {
      id: "agent-assigned-email",
      name: "Tell the customer which agent is coming",
      triggers: [agentAssignedEvent],
    },
    async ({ event, step, logger }) => {
      const emailResult = await step.run("send-agent-assigned-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };
        if (booking.status === "cancelled" || booking.status === "completed") {
          return { sent: false, reason: "not_live" };
        }

        const [customer, agent, tz] = await Promise.all([
          config.db.query.users.findFirst({
            where: eq(users.id, booking.userId),
            columns: { email: true },
          }),
          config.db.query.users.findFirst({
            where: eq(users.id, event.data.agentUserId),
            columns: { fullName: true },
          }),
          resolveDisplayTz(config.db, booking.departureAirport),
        ]);
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        // The BOOKING's zone, never the server's (docs/TIME.md). A window
        // rendered in UTC is four or five hours wrong in the unsafe direction.
        const windowLabel =
          booking.pickupWindowStart && booking.pickupWindowEnd
            ? formatWindowInAirportTz(
                booking.pickupWindowStart,
                booking.pickupWindowEnd,
                tz,
              )
            : "to be scheduled";

        const message = buildAgentAssignedEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          agentGivenName: agent?.fullName?.trim().split(/\s+/)[0] ?? null,
          windowLabel,
          ...(tripUrlFor(booking.id) === undefined
            ? {}
            : { tripUrl: tripUrlFor(booking.id)! }),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "warning",
            title: `Agent-assigned email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id };
      });

      /*
       * TWO AUDIENCES, ONE EVENT — and they are not the same notification.
       *
       * The customer is being told a MILESTONE ("Nina is coming"), so it
       * collapses onto the booking's one notification. The agent is being
       * given WORK, so it stacks: a second assignment is a second job, and a
       * replaced notification would be a visit nobody knows about.
       *
       * The horizon sweep reaches here too — it assigns through
       * `assignAgentToBooking`, which emits this event like every other path.
       */
      await step.run("push-agent-assigned", async () => {
        const config = getConfig();
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { id: true, ref: true, userId: true, status: true },
        });
        if (!booking) return { skipped: "booking_missing" };
        if (booking.status === "cancelled" || booking.status === "completed") {
          return { skipped: "not_live" };
        }

        const agent = await config.db.query.users.findFirst({
          where: eq(users.id, event.data.agentUserId),
          columns: { fullName: true },
        });
        const agentGivenName = agent?.fullName?.trim().split(/\s+/)[0] ?? null;

        const customer = await pushToUsers(
          config,
          [booking.userId],
          {
            title: agentGivenName
              ? `${agentGivenName} is your agent`
              : "Your agent is assigned",
            body: `${booking.ref} · they'll collect your bags at your door.`,
            tag: customerTag(booking.id),
            renotify: true,
            ...withUrl(tripUrlFor(booking.id)),
          },
          { urgency: "normal" },
        );

        // The task id is looked up rather than carried: the event's shape is
        // fixed, and the row is the truth about which visit this is.
        const task = await config.db.query.verificationTasks.findFirst({
          where: eq(verificationTasks.bookingId, booking.id),
          columns: { id: true },
        });
        const agentPush = await pushToUsers(
          config,
          [event.data.agentUserId],
          {
            title: "New visit assigned",
            // Names and a ref only. No address, nothing passport-shaped: a
            // push is decrypted onto a lock screen that may be face-up on a
            // table.
            body: `${booking.ref} — check the schedule for the window.`,
            tag: task ? `verification-task:${task.id}` : `verification:${booking.id}`,
            ...withUrl(task ? taskUrlFor(task.id) : undefined),
          },
          { urgency: "high" },
        );

        return { customer, agent: agentPush };
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 9. "Your bags are sealed — choose your driver"                      */
  /* ------------------------------------------------------------------ */

  /**
   * ONE EMAIL FOR TWO MATRIX ROWS. `verified_sealed` is simultaneously the
   * moment the last seal goes on and the moment the driver shortlist opens
   * (`DRIVER_SELECTABLE_STATUSES`), so a "bags sealed" summary and a "choose
   * your driver" prompt would arrive seconds apart. They are one message.
   *
   * The seal numbers are read HERE rather than carried on the event, because
   * an event payload is a snapshot and a seal is evidence the agent could
   * still have corrected between the transition and the send.
   */
  const bagsSealedEmail = inngest.createFunction(
    {
      id: "bags-sealed-email",
      name: "Tell the customer their bags are sealed and a driver is theirs to pick",
      triggers: [bagsSealedEvent],
    },
    async ({ event, step, logger }) => {
      const emailResult = await step.run("send-bags-sealed-email", async () => {
        const config = getConfig();

        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };
        if (booking.status === "cancelled") return { sent: false, reason: "cancelled" };

        const [customer, sealed] = await Promise.all([
          config.db.query.users.findFirst({
            where: eq(users.id, booking.userId),
            columns: { email: true },
          }),
          config.db
            .select({ ordinal: bags.ordinal, sealId: bags.sealId })
            .from(bags)
            .where(eq(bags.bookingId, booking.id))
            // By ordinal: a booking's bags share a created_at to the
            // millisecond, so any other order is a non-deterministic tie and
            // "Bag 1" would move between renders of the same email.
            .orderBy(bags.ordinal),
        ]);
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        const sealIds = sealed
          .map((row) => row.sealId)
          .filter((seal): seal is string => Boolean(seal));

        const message = buildBagsSealedEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          bagCount: sealed.length,
          sealIds,
          ...(tripUrlFor(booking.id) === undefined
            ? {}
            : { tripUrl: tripUrlFor(booking.id)! }),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "warning",
            title: `Bags-sealed email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id, bagCount: sealed.length };
      });

      /*
       * The same one notification per booking, replaced. "Nina is your agent"
       * becomes "your bags are sealed" — a lock screen should show where the
       * bags ARE, not a stack of everywhere they have been.
       */
      await step.run("push-bags-sealed", async () => {
        const config = getConfig();
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
          columns: { id: true, ref: true, userId: true, bagCount: true, status: true },
        });
        if (!booking) return { skipped: "booking_missing" };
        if (booking.status === "cancelled") return { skipped: "cancelled" };

        return pushToUsers(
          config,
          [booking.userId],
          {
            title: "Your bags are sealed",
            body:
              `${booking.ref} · ${booking.bagCount} ` +
              `${booking.bagCount === 1 ? "bag" : "bags"} — choose your driver.`,
            tag: customerTag(booking.id),
            renotify: true,
            ...withUrl(tripUrlFor(booking.id)),
          },
          { urgency: "normal" },
        );
      });

      return emailResult;
    },
  );

  /* ------------------------------------------------------------------ */
  /* 10. "We're on it" — the customer half of an exception               */
  /* ------------------------------------------------------------------ */

  /**
   * The same event as the ops alert, a completely different message.
   *
   * Ops gets the reason because they can act on it. The customer gets none of
   * it, on purpose: the internal reason is written for an operator, it can
   * name staff or a payment provider, and it is frequently wrong in the first
   * minute because an exception is raised before anybody has looked. What the
   * customer needs is that a human now owns their booking.
   *
   * A SEPARATE FUNCTION rather than a second send inside the ops one, because
   * an ops alert that fails must still be retried on its own — Inngest retries
   * a function, and a combined handler would re-send whichever half already
   * succeeded.
   */
  const exceptionCustomerEmail = inngest.createFunction(
    {
      id: "exception-customer-email",
      name: "Tell the customer we have hit a snag",
      triggers: [exceptionRaised],
    },
    async ({ event, step, logger }) => {
      return step.run("send-customer-exception-email", async () => {
        const supportEmail = options.supportEmail;
        if (!supportEmail) {
          // Better to say nothing than to hand somebody an address nobody
          // reads at the moment they most need a reply.
          logger.info(
            "No support address configured; skipping customer exception email.",
          );
          return { sent: false, reason: "no_support_email" };
        }

        const config = getConfig();
        const booking = await config.db.query.bookings.findFirst({
          where: eq(bookings.id, event.data.bookingId),
        });
        if (!booking) return { sent: false, reason: "booking_missing" };

        const customer = await config.db.query.users.findFirst({
          where: eq(users.id, booking.userId),
          columns: { email: true },
        });
        if (!customer?.email) {
          logger.info(`Booking ${booking.id}: customer has no email; skipping.`);
          return { sent: false, reason: "no_email" };
        }

        const message = buildCustomerExceptionEmail({
          to: customer.email,
          bookingRef: booking.ref,
          paxName: booking.paxName,
          supportEmail,
          ...(tripUrlFor(booking.id) === undefined
            ? {}
            : { tripUrl: tripUrlFor(booking.id)! }),
        });

        try {
          await config.notifier.sendEmail(message);
        } catch (error) {
          await config.opsAlerter.alert({
            severity: "warning",
            title: `Customer exception email failed for booking ${booking.id}`,
            detail: { bookingId: booking.id, error: String(error) },
          });
          return { sent: false, reason: "send_failed" };
        }
        return { sent: true, bookingId: booking.id };
      });
    },
  );

  /* ------------------------------------------------------------------ */
  /* 12. Assignment horizon sweep                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Assigns bookings whose pickup window has just entered the assignment
   * horizon (`defaults.assignmentHorizonHours`, default 48).
   *
   * The other half of deferred assignment. `autoAssignOnPaid` handles every
   * booking already inside the horizon at the moment the card clears — which
   * is every same-day and next-day booking — and creates nothing for the
   * rest. This picks those up as they come into range.
   *
   * five-minute for the same reason `capture-due-bookings` uses it: nothing
   * server-side observes a clock crossing a threshold, so the sweep is the
   * observation. Five minutes of lag on a 48-hour horizon is not a lag worth
   * modelling. Overlapping runs are harmless — the unique index on
   * `verification_tasks(booking_id)` referees, exactly as it does for the
   * webhook/return-page race.
   *
   * Never throws: `assignEnteringHorizon` catches per booking, so one
   * uncoverable ZIP cannot stop the rest of the batch.
   */
  const assignmentHorizonSweep = inngest.createFunction(
    {
      id: "assignment-horizon-sweep",
      name: "Assign agents to bookings entering the horizon",
      triggers: [cron("*/5 * * * *")],
    },
    async ({ step, logger }) => {
      return step.run("assign-entering-horizon", async () => {
        const result = await assignEnteringHorizon(getConfig());
        if (result.considered > 0) {
          logger.info(
            `horizon sweep: ${result.assigned.length} assigned, ` +
              `${result.uncovered.length} uncovered, ${result.raced.length} raced ` +
              `(of ${result.considered} considered)`,
          );
        }
        return {
          considered: result.considered,
          assigned: result.assigned.length,
          uncovered: result.uncovered.length,
          raced: result.raced.length,
        };
      });
    },
  );

  return [
    bookingConfirmationEmail,
    pickupReminder,
    assignmentHorizonSweep,
    exceptionOpsAlertEmail,
    waitlistZoneOpenedSweep,
    cutoffRiskMonitor,
    agentNoShowCheck,
    driverSelectedEmail,
    bagdropDeliveredEmail,
    driverPoolEmptyOpsAlert,
    agentAssignedEmail,
    bagsSealedEmail,
    exceptionCustomerEmail,
  ];
}

export type KooleeFunctions = ReturnType<typeof createKooleeFunctions>;
