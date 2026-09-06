import {
  formatHourRangeInAirportTz,
  formatInstantInAirportTz,
  type CustodyEvent,
} from "@koolee/core";

/**
 * Turns a `custody_events` row into something an operator can read.
 *
 * Ops voice, not customer voice — the web app's timeline says "Driver
 * collected your bags"; this says who did what to which record. That is why
 * the two label maps are deliberately NOT shared: the same event genuinely
 * needs different words on a trip page and on a dispatch console.
 *
 * Everything here is presentation over an append-only log. Nothing is
 * inferred or reconciled: if a field is missing from `metadata`, the sentence
 * simply omits it rather than guessing. The caller pairs this with the raw
 * JSON behind a disclosure, so a phrase we do not know how to write can never
 * hide a fact that was recorded.
 */

export interface CustodyLine {
  /** One sentence: what happened. */
  headline: string;
  /** Humanized supporting facts pulled out of `metadata`. */
  details: string[];
}

type Meta = Record<string, unknown>;

const str = (meta: Meta, key: string): string | undefined => {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const num = (meta: Meta, key: string): number | undefined => {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const money = (cents: number | undefined): string | undefined =>
  cents === undefined ? undefined : `$${(cents / 100).toFixed(2)}`;

/** `customer_id_mismatch` → `customer id mismatch`. */
const humanizeToken = (token: string): string => token.replace(/[_-]+/g, " ");

/**
 * Only a single snake_case/kebab token is a machine enum worth unmangling.
 * `reason` carries BOTH kinds: the agent app writes `customer_not_home`, and
 * an operator resolving an exception types a sentence — which may legitimately
 * contain `STRIPE_SECRET_KEY` or a seal id. Humanizing that would rewrite what
 * a human actually said into the custody record, which is the one thing this
 * view must never do.
 */
const isMachineToken = (value: string): boolean =>
  /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(value);

const humanizeIfToken = (value: string): string =>
  isMachineToken(value) ? humanizeToken(value) : value;

/** `pickupWindowStart` → `Pickup window start`. Sentence case, not Title Case. */
const humanizeKey = (key: string): string => {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const timeRange = (meta: Meta, tz: string): string | undefined => {
  const start = str(meta, "pickupWindowStart");
  const end = str(meta, "pickupWindowEnd");
  if (!start) return undefined;
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return undefined;
  const to = end ? new Date(end) : null;
  // Rendered in the booking's zone like every other time on the page: a
  // custody line that disagreed with the pickup window above it would read as
  // a data error rather than a formatting one.
  return to && !Number.isNaN(to.getTime())
    ? `pickup ${formatHourRangeInAirportTz(from, to, tz)}`
    : `pickup ${formatInstantInAirportTz(from, tz)}`;
};

/** Keys already spoken by a headline or a detail — not repeated verbatim. */
const CONSUMED = new Set([
  "amountCents",
  "agentUserId",
  "bagCount",
  "captureRef",
  "detail",
  // The state machine stamps these on every transition. `from`/`to` collapse
  // into one arrow below; `event` is what the headline already says.
  "event",
  "from",
  "to",
  "note",
  "pickupWindowEnd",
  "pickupWindowStart",
  "priceCents",
  "provider",
  "providerRef",
  "reason",
  "refundId",
  "sealId",
  "source",
  "taskId",
  "weightKg",
  // Driver / pickup slice.
  "bagId",
  "etaMaxMinutes",
  "etaMinMinutes",
  "ordinal",
  "presented",
  "shiftId",
  "truckId",
  "truckName",
  "overrode",
]);

const HEADLINES: Record<string, string> = {
  "booking.created": "Booking created.",
  "booking.payment_authorized": "Card authorized — funds held, not yet taken.",
  "booking.payment_captured": "Payment captured.",
  "booking.payment_refunded": "Payment refunded in full.",
  "booking.payment_auth_cancelled": "Card authorization voided — nothing was charged.",
  "booking.payment_unwind_failed":
    "Booking cancelled but the money did not unwind — needs a manual check in the provider dashboard.",
  "booking.agent_assigned": "Agent assigned to the verification visit and pickup run.",
  "booking.agent_reassigned": "Visit handed to a different agent.",
  "visit.arrived": "Agent arrived at the pickup address.",
  // Superseded by the passport events below — kept because it is the only
  // record of every visit performed before the agreement/passport slice.
  "visit.identity_verified": "Photo ID checked against the name on the ticket.",
  "agreement.accepted": "Customer accepted the booking agreement.",
  "passport.customer_uploaded": "Customer uploaded a passport photo.",
  "passport.agent_captured": "Agent photographed the passport at the door.",
  "passport.agent_confirmed": "Agent confirmed the passport matches the traveler.",
  "bag.sealed": "Bag sealed.",
  "booking.verified_sealed":
    "Verification visit complete — bags sealed and in our custody.",
  "booking.awaiting_pickup": "Marked ready for the pickup run.",
  // The driver half. Ops voice: shift, truck and driver by name, because
  // "who has these bags and in what" is the question this console answers.
  "pickup.driver_selected": "Customer chose a driver.",
  "pickup.driver_released": "Previous driver released — the customer chose again.",
  "pickup.travel_started": "Driver set off for the pickup address.",
  "pickup.seal_scanned": "Seal matched at the door.",
  "pickup.seal_mismatch":
    "A seal NOT on this booking was presented at the door — the bag was refused.",
  "pickup.handover_confirmed": "Airline took the bags at the counter.",
  "pickup.shift_force_ended":
    "Shift force-ended from the console — this pickup went back in the pool.",
  "pickup.reassigned": "Pickup moved to a different driver from the console.",
  "pickup.unassigned":
    "Driver removed from the console — this pickup is back in the pool and shows as awaiting a driver.",
  "booking.in_transit": "Bags collected — in transit to the airport.",
  "booking.delivered_to_bagdrop": "Bags handed to the airline bag drop.",
  "booking.completed": "Booking completed.",
  "booking.exception_raised": "Exception raised — the booking is parked for ops.",
  "booking.exception_resolved_resumed": "Exception resolved — put back in transit.",
  "booking.exception_resolved_completed": "Exception resolved — force-completed.",
  "booking.cancelled": "Booking cancelled.",
  "booking.correction": "Record corrected.",
};

/**
 * Per-event supporting facts. Anything a headline does not already say and
 * that an operator would otherwise have to read out of the JSON.
 */
function detailsFor(eventType: string, meta: Meta, tz: string): string[] {
  const details: string[] = [];
  const provider = str(meta, "provider");
  const amount = money(num(meta, "amountCents"));

  switch (eventType) {
    case "booking.created": {
      const bags = num(meta, "bagCount");
      const price = money(num(meta, "priceCents"));
      if (bags !== undefined) details.push(`${bags} bag${bags === 1 ? "" : "s"}`);
      const window = timeRange(meta, tz);
      if (window) details.push(window);
      if (price) details.push(`quoted ${price}`);
      break;
    }
    case "booking.payment_authorized": {
      if (provider) details.push(`via ${provider}`);
      const ref = str(meta, "providerRef");
      if (ref) details.push(`ref ${ref}`);
      break;
    }
    case "booking.payment_captured": {
      if (amount) details.push(amount);
      if (provider) details.push(`via ${provider}`);
      const capture = str(meta, "captureRef") ?? str(meta, "providerRef");
      if (capture) details.push(`ref ${capture}`);
      break;
    }
    case "booking.payment_refunded": {
      if (amount) details.push(amount);
      if (provider) details.push(`via ${provider}`);
      const refund = str(meta, "refundId");
      if (refund) details.push(`refund ${refund}`);
      break;
    }
    case "booking.payment_auth_cancelled": {
      if (provider) details.push(`via ${provider}`);
      const ref = str(meta, "providerRef");
      if (ref) details.push(`ref ${ref}`);
      break;
    }
    case "bag.sealed": {
      const seal = str(meta, "sealId");
      const weight = num(meta, "weightKg");
      if (seal) details.push(`seal ${seal}`);
      if (weight !== undefined) details.push(`${weight} kg`);
      break;
    }
    case "visit.identity_verified": {
      const pax = str(meta, "paxName");
      if (pax) details.push(`ticket name ${pax}`);
      break;
    }
    case "booking.verified_sealed": {
      const bags = num(meta, "bagCount");
      if (bags !== undefined) details.push(`${bags} bag${bags === 1 ? "" : "s"} sealed`);
      break;
    }
    case "pickup.driver_selected": {
      const truck = str(meta, "truckName");
      const bags = num(meta, "bagCount");
      const etaMin = num(meta, "etaMinMinutes");
      const etaMax = num(meta, "etaMaxMinutes");
      if (truck) details.push(truck);
      if (bags !== undefined) details.push(`${bags} bag${bags === 1 ? "" : "s"}`);
      if (etaMin !== undefined && etaMax !== undefined) {
        details.push(`ETA ${etaMin}–${etaMax} min at the time of choosing`);
      } else {
        // A driver with no position yet is a normal state, not a gap.
        details.push("no driver position when chosen");
      }
      break;
    }
    case "pickup.seal_scanned": {
      const seal = str(meta, "sealId");
      const ordinal = num(meta, "ordinal");
      if (ordinal !== undefined) details.push(`bag ${ordinal}`);
      if (seal) details.push(`seal ${seal}`);
      break;
    }
    case "pickup.seal_mismatch": {
      const presented = str(meta, "presented");
      if (presented) details.push(`presented ${presented}`);
      break;
    }
    case "pickup.shift_force_ended": {
      const truck = str(meta, "truckId");
      if (truck) details.push(`truck ${truck}`);
      break;
    }
    case "pickup.reassigned": {
      const truck = str(meta, "truckName");
      if (truck) details.push(truck);
      // `overrode` is an ARRAY, and the generic fallback below skips objects —
      // so without this case an ops override would show only in Raw data. That
      // is the one fact on this event a reader must not have to dig for: it is
      // why a van may have left over capacity or out of its zone.
      const overrode = meta["overrode"];
      if (Array.isArray(overrode) && overrode.length > 0) {
        details.push(`OVERRIDE: ${overrode.map(String).join(" and ")}`);
      }
      break;
    }
    default:
      break;
  }

  // The status move itself, when this row came from a transition. One arrow
  // beats three leftover keys, and it is the fact an override audit wants.
  const from = str(meta, "from");
  const to = str(meta, "to");
  if (from && to) details.push(`${from} → ${to}`);

  // Reason / note / failure detail read the same way on every event that
  // carries them, so they are handled once here rather than per case.
  const reason = str(meta, "reason");
  if (reason) details.push(`reason: ${humanizeIfToken(reason)}`);
  const note = str(meta, "note");
  if (note) details.push(`note: ${note}`);
  const detail = str(meta, "detail");
  if (detail) details.push(detail);

  // Anything we have no phrasing for still gets shown, just readably.
  for (const [key, value] of Object.entries(meta)) {
    if (CONSUMED.has(key) || value == null) continue;
    if (typeof value === "object") continue; // nested shapes stay in Raw data
    details.push(`${humanizeKey(key)}: ${String(value)}`);
  }

  return details;
}

/** How the event got written, when the writer said so. */
function sourceSuffix(meta: Meta): string {
  switch (str(meta, "source")) {
    case "admin_manual_override":
      return " Applied as a manual override from the ops console.";
    case "admin_exception_resolution":
      return " Applied as an exception resolution from the ops console.";
    default:
      return "";
  }
}

export function describeCustodyEvent(event: CustodyEvent, tz: string): CustodyLine {
  const meta = (event.metadata ?? {}) as Meta;
  const known = HEADLINES[event.eventType];
  // Unknown types are readable rather than raw: `visit.bag_refused` reads as
  // "Visit bag refused." — better than the dotted token, honest about the
  // fact that we have no copy for it.
  const headline = known ?? `${humanizeToken(event.eventType.replace(/\./g, " "))}.`;
  const sentence = headline.charAt(0).toUpperCase() + headline.slice(1);

  return {
    headline: `${sentence}${sourceSuffix(meta)}`,
    details: detailsFor(event.eventType, meta, tz),
  };
}
