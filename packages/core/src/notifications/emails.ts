import type { EmailMessage } from "./notifier";

/**
 * Transactional email templates — pure builders, no I/O, fully unit-testable.
 *
 * COPY RULES ARE HARD CONSTRAINTS (PROJECT-STATUS §7):
 *  - the service is "delivered to your airline's bag drop" — never "check
 *    you in" or any claim of airline check-in;
 *  - no fabricated claims: nothing the product does not actually do.
 *
 * Brand (brand/BRAND.md): navy #0B2545 is the text color, sky #38B6E3 the
 * accent; Tag Orange #FF6B35 appears ONLY on the CTA — nowhere else, ever.
 * Every message carries a plain-text body (the deliverability baseline);
 * HTML is the optional upgrade on top.
 */

const NAVY = "#0B2545";
const SKY = "#38B6E3";
/** CTA background — the ONLY place this token may appear. */
const ORANGE = "#FF6B35";

export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Shared shell: navy text on white, sky rule under the heading. */
function layout(
  heading: string,
  bodyHtml: string,
  cta?: { label: string; url: string },
): string {
  const button = cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(cta.url)}" ` +
      `style="background:${ORANGE};color:#ffffff;text-decoration:none;` +
      `padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">` +
      `${escapeHtml(cta.label)}</a></p>`
    : "";
  return (
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `color:${NAVY};max-width:560px;margin:0 auto;padding:24px;">` +
    `<h1 style="font-size:20px;margin:0 0 4px;">${escapeHtml(heading)}</h1>` +
    `<div style="height:3px;width:48px;background:${SKY};border-radius:2px;margin:0 0 20px;"></div>` +
    bodyHtml +
    button +
    `<p style="font-size:12px;color:#5a6b82;margin-top:32px;">Koolee — doorstep luggage pickup, ` +
    `delivered to your airline's bag drop.</p>` +
    `</div>`
  );
}

export interface PriceLine {
  label: string;
  amountCents: number;
}

export interface BookingConfirmationEmailInput {
  to: string;
  /** `KOO-XXXXX` — what the customer quotes to support. */
  bookingRef: string;
  paxName: string;
  flightNumber: string;
  departureAirport: string;
  /** Preformatted, airport-local with zone abbreviation (docs/TIME.md). */
  windowLabel: string;
  /** Preformatted departure instant, airport-local with abbreviation. */
  departureLabel: string;
  addressLine: string;
  bagCount: number;
  priceLines: PriceLine[];
  totalCents: number;
  /** Absolute trip-page link. Omitted → no CTA (and no orange anywhere). */
  tripUrl?: string;
}

export function buildBookingConfirmationEmail(
  input: BookingConfirmationEmailInput,
): EmailMessage {
  const bags = `${input.bagCount} ${input.bagCount === 1 ? "bag" : "bags"}`;
  const priceText = [
    ...input.priceLines.map((l) => `  ${l.label}: ${centsToUsd(l.amountCents)}`),
    `  Total: ${centsToUsd(input.totalCents)}`,
  ].join("\n");

  const body = [
    `Hi ${input.paxName},`,
    ``,
    `Your Koolee pickup is confirmed for flight ${input.flightNumber} from ${input.departureAirport}.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    `Pickup window: ${input.windowLabel}`,
    `Flight departs: ${input.departureLabel}`,
    `Pickup address: ${input.addressLine}`,
    `Bags: ${bags}`,
    ``,
    `Price:`,
    priceText,
    ``,
    `We collect your ${bags} at your door, seal each one in front of you, and ` +
      `deliver them to your airline's bag drop. You travel to the airport hands-free.`,
    ``,
    `One thing to do: open your trip page and accept our booking agreement — your ` +
      `agent can't collect your bags until you have. While you're there you can add ` +
      `a photo of your passport page, which speeds up the check at your door; it's ` +
      `optional, and your agent checks your passport either way.`,
    ...(input.tripUrl ? [``, `Track your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const priceRows = [
    ...input.priceLines,
    { label: "Total", amountCents: input.totalCents },
  ]
    .map(
      (l, i, all) =>
        `<tr><td style="padding:2px 12px 2px 0;${i === all.length - 1 ? "font-weight:600;" : ""}">` +
        `${escapeHtml(l.label)}</td><td style="text-align:right;${i === all.length - 1 ? "font-weight:600;" : ""}">` +
        `${centsToUsd(l.amountCents)}</td></tr>`,
    )
    .join("");

  const html = layout(
    "Your pickup is confirmed",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>Your Koolee pickup is confirmed for flight <strong>${escapeHtml(input.flightNumber)}</strong> ` +
      `from <strong>${escapeHtml(input.departureAirport)}</strong>.</p>` +
      `<table style="border-collapse:collapse;margin:16px 0;">` +
      `<tr><td style="padding:2px 12px 2px 0;">Booking reference</td><td><strong>${escapeHtml(input.bookingRef)}</strong></td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;">Pickup window</td><td>${escapeHtml(input.windowLabel)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;">Flight departs</td><td>${escapeHtml(input.departureLabel)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;">Pickup address</td><td>${escapeHtml(input.addressLine)}</td></tr>` +
      `<tr><td style="padding:2px 12px 2px 0;">Bags</td><td>${escapeHtml(bags)}</td></tr>` +
      `</table>` +
      `<table style="border-collapse:collapse;margin:16px 0;">${priceRows}</table>` +
      `<p>We collect your ${escapeHtml(bags)} at your door, seal each one in front of you, and ` +
      `deliver them to your airline's bag drop. You travel to the airport hands-free.</p>` +
      `<p><strong>One thing to do:</strong> open your trip page and accept our booking ` +
      `agreement — your agent can't collect your bags until you have. While you're there ` +
      `you can add a photo of your passport page, which speeds up the check at your door; ` +
      `it's optional, and your agent checks your passport either way.</p>`,
    input.tripUrl ? { label: "Track your trip", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    // The ref leads: it is the one token in this email a support agent can
    // act on, and a customer searching their inbox for it should hit here.
    subject: `Pickup confirmed — ${input.bookingRef} · ${input.flightNumber} from ${input.departureAirport}`,
    body,
    html,
  };
}

export interface PickupReminderEmailInput {
  to: string;
  /** `KOO-XXXXX` — what the customer quotes to support. */
  bookingRef: string;
  paxName: string;
  /** Preformatted, airport-local with zone abbreviation. */
  windowLabel: string;
  bagCount: number;
  tripUrl?: string;
}

export function buildPickupReminderEmail(input: PickupReminderEmailInput): EmailMessage {
  const bags = `${input.bagCount} ${input.bagCount === 1 ? "bag" : "bags"}`;
  const body = [
    `Hi ${input.paxName},`,
    ``,
    `Your Koolee pickup window is coming up: ${input.windowLabel}.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    ``,
    `Please have your ${bags} packed and your passport ready. We'll seal your ` +
      `bags in front of you and deliver them to your airline's bag drop.`,
    ``,
    `If you haven't accepted our booking agreement yet, please do that on your trip ` +
      `page — your agent can't collect your bags until you have.`,
    ...(input.tripUrl ? [``, `Track your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    "Your pickup window is coming up",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>Your Koolee pickup window is coming up: <strong>${escapeHtml(input.windowLabel)}</strong>.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      `<p>Please have your ${escapeHtml(bags)} packed and your passport ready. We'll seal your ` +
      `bags in front of you and deliver them to your airline's bag drop.</p>` +
      `<p>If you haven't accepted our booking agreement yet, please do that on your trip ` +
      `page — your agent can't collect your bags until you have.</p>`,
    input.tripUrl ? { label: "Track your trip", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `Pickup reminder — ${input.bookingRef} · ${input.windowLabel}`,
    body,
    html,
  };
}

export interface ZoneOpenedEmailInput {
  to: string;
  /** The ZIP this signup was waiting on. */
  zip: string;
  /** Absolute link to start booking. Omitted → no CTA (and no orange). */
  bookUrl?: string;
}

/**
 * The one email the waitlist promises: "the message that says you're
 * covered". Sent by the zone-opened sweep when a signup's ZIP enters
 * coverage; `notified_at` is stamped on success so it goes out exactly once.
 */
export function buildZoneOpenedEmail(input: ZoneOpenedEmailInput): EmailMessage {
  const body = [
    `Good news — Koolee now covers ${input.zip}.`,
    ``,
    `You asked us to tell you when your neighborhood opened, and it just did. ` +
      `We pick up your bags at your door, seal them in front of you, and ` +
      `deliver them to your airline's bag drop.`,
    ...(input.bookUrl ? [``, `Book a pickup: ${input.bookUrl}`] : []),
    ``,
    `This is the only waitlist email we send.`,
  ].join("\n");

  const html = layout(
    `Koolee now covers ${input.zip}`,
    `<p>Good news — Koolee now covers <strong>${escapeHtml(input.zip)}</strong>.</p>` +
      `<p>You asked us to tell you when your neighborhood opened, and it just did. ` +
      `We pick up your bags at your door, seal them in front of you, and ` +
      `deliver them to your airline's bag drop.</p>` +
      `<p>This is the only waitlist email we send.</p>`,
    input.bookUrl ? { label: "Book a pickup", url: input.bookUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `Koolee now covers ${input.zip}`,
    body,
    html,
  };
}

export interface OpsExceptionEmailInput {
  to: string;
  bookingId: string;
  /**
   * `KOO-XXXXX`, when the alert path could resolve one. Optional because this
   * email is built from an event payload rather than a row — an alert that
   * reaches ops without a ref is far better than one that does not reach them.
   */
  bookingRef?: string | undefined;
  reason: string;
  raisedByUserId?: string | undefined;
}

/** Internal ops alert — plain and factual, no CTA (and therefore no orange). */
export function buildOpsExceptionEmail(input: OpsExceptionEmailInput): EmailMessage {
  const label = input.bookingRef
    ? `${input.bookingRef} (${input.bookingId})`
    : input.bookingId;
  const body = [
    `Booking ${label} entered the exception state.`,
    ``,
    `Reason: ${input.reason}`,
    ...(input.raisedByUserId
      ? [`Raised by: ${input.raisedByUserId}`]
      : [`Raised by: system`]),
    ``,
    `Resolve it from the admin console's exceptions queue.`,
  ].join("\n");

  const html = layout(
    "Booking exception",
    `<p>Booking <strong>${escapeHtml(label)}</strong> entered the exception state.</p>` +
      `<p>Reason: ${escapeHtml(input.reason)}<br/>` +
      `Raised by: ${escapeHtml(input.raisedByUserId ?? "system")}</p>` +
      `<p>Resolve it from the admin console's exceptions queue.</p>`,
  );

  return {
    to: input.to,
    subject: `Exception — booking ${input.bookingRef ?? input.bookingId}`,
    body,
    html,
  };
}

export interface DriverSelectedEmailInput {
  to: string;
  /** `KOO-XXXXX` — what the customer quotes to support. */
  bookingRef: string;
  paxName: string;
  /** First name only. Null when the driver has no name on file. */
  driverGivenName: string | null;
  bagCount: number;
  tripUrl?: string;
}

/**
 * "Your driver is booked" — sent when the customer picks one.
 *
 * Deliberately carries NO ETA. The estimate is live, it moves, and an email is
 * a snapshot: a message saying "20-30 minutes" that arrives while the customer
 * reads it an hour later is worse than one that points at the page where the
 * real number is.
 */
export function buildDriverSelectedEmail(input: DriverSelectedEmailInput): EmailMessage {
  const bags = `${input.bagCount} ${input.bagCount === 1 ? "bag" : "bags"}`;
  const driver = input.driverGivenName ?? "Your driver";
  const body = [
    `Hi ${input.paxName},`,
    ``,
    `${driver} is on your pickup.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    ``,
    `${driver} will collect your ${bags} and deliver them to your airline's bag drop. ` +
      `Your trip page shows where they are and how long they'll be.`,
    ...(input.tripUrl ? [``, `Track your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    `${driver} is on your pickup`,
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p><strong>${escapeHtml(driver)}</strong> is on your pickup.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      `<p>${escapeHtml(driver)} will collect your ${escapeHtml(bags)} and deliver them to ` +
      `your airline's bag drop. Your trip page shows where they are and how long ` +
      `they'll be.</p>`,
    input.tripUrl ? { label: "Track your trip", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `Driver on the way — ${input.bookingRef}`,
    body,
    html,
  };
}

export interface BagdropDeliveredEmailInput {
  to: string;
  bookingRef: string;
  paxName: string;
  flightNumber: string;
  departureAirport: string;
  bagCount: number;
  tripUrl?: string;
}

/**
 * "Your bags are at the bag drop."
 *
 * The copy rule bites hardest here: this email says the bags reached the
 * AIRLINE'S BAG DROP. It must never say checked in, checked through, or
 * anything implying Koolee dealt with the airline on the customer's behalf.
 */
export function buildBagdropDeliveredEmail(
  input: BagdropDeliveredEmailInput,
): EmailMessage {
  const bags = `${input.bagCount} ${input.bagCount === 1 ? "bag" : "bags"}`;
  const body = [
    `Hi ${input.paxName},`,
    ``,
    `Your ${bags} reached the bag drop for ${input.flightNumber} at ` +
      `${input.departureAirport}.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    ``,
    `Your seal numbers and the photo from every hand-off are on your trip page.`,
    ...(input.tripUrl ? [``, `See your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    "Delivered to your airline's bag drop",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>Your ${escapeHtml(bags)} reached the bag drop for ` +
      `<strong>${escapeHtml(input.flightNumber)}</strong> at ` +
      `${escapeHtml(input.departureAirport)}.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      `<p>Your seal numbers and the photo from every hand-off are on your trip page.</p>`,
    input.tripUrl ? { label: "See your trip", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `Bags delivered — ${input.bookingRef} · ${input.flightNumber}`,
    body,
    html,
  };
}

export interface OpsDriverPoolEmptyEmailInput {
  to: string;
  bookingId: string;
  bookingRef?: string | undefined;
  /** ZIP the pickup is in — the first thing ops looks at. */
  zip?: string | undefined;
  bagCount?: number | undefined;
  /** Preformatted, airport-local with abbreviation. */
  departureLabel?: string | undefined;
}

/**
 * Internal ops alert: a sealed booking was shown to a customer and there was
 * nobody to offer.
 *
 * The customer is not told the pool is empty — they are told a driver is being
 * assigned, which is true only if somebody acts on THIS email. Plain and
 * factual, no CTA (and therefore no orange).
 */
export function buildOpsDriverPoolEmptyEmail(
  input: OpsDriverPoolEmptyEmailInput,
): EmailMessage {
  const label = input.bookingRef
    ? `${input.bookingRef} (${input.bookingId})`
    : input.bookingId;
  const body = [
    `No driver could be offered for booking ${label}.`,
    ``,
    `The bags are sealed and the customer has been told a driver is being assigned.`,
    ``,
    ...(input.zip ? [`Pickup ZIP: ${input.zip}`] : []),
    ...(input.bagCount !== undefined ? [`Bags: ${input.bagCount}`] : []),
    ...(input.departureLabel ? [`Flight departs: ${input.departureLabel}`] : []),
    ``,
    `Nobody on shift covers that ZIP with room for these bags. Start a shift, ` +
      `free capacity, or assign the pickup by hand from the console.`,
  ].join("\n");

  const html = layout(
    "No driver available",
    `<p>No driver could be offered for booking <strong>${escapeHtml(label)}</strong>.</p>` +
      `<p>The bags are sealed and the customer has been told a driver is being assigned.</p>` +
      `<p>` +
      [
        input.zip ? `Pickup ZIP: ${escapeHtml(input.zip)}` : null,
        input.bagCount !== undefined ? `Bags: ${input.bagCount}` : null,
        input.departureLabel
          ? `Flight departs: ${escapeHtml(input.departureLabel)}`
          : null,
      ]
        .filter(Boolean)
        .join("<br/>") +
      `</p>` +
      `<p>Nobody on shift covers that ZIP with room for these bags. Start a shift, ` +
      `free capacity, or assign the pickup by hand from the console.</p>`,
  );

  return {
    to: input.to,
    subject: `No driver available — booking ${input.bookingRef ?? input.bookingId}`,
    body,
    html,
  };
}

/* ------------------------------------------------------------------ */
/* The F2 additions — the gaps in the notification matrix              */
/* ------------------------------------------------------------------ */

export interface AgentAssignedEmailInput {
  to: string;
  bookingRef: string;
  paxName: string;
  /** First name only. Null when the agent has no name on file. */
  agentGivenName: string | null;
  /** Preformatted, airport-local with zone abbreviation (docs/TIME.md). */
  windowLabel: string;
  tripUrl?: string;
}

/**
 * "Your agent is <name>" — sent the moment a verification visit gets an owner.
 *
 * NO PHOTO IN THE EMAIL, on purpose, even though the trip page shows one.
 * An avatar lives in a PRIVATE bucket and is read through a signed URL that
 * expires in an hour; an email is read whenever it is read, so an embedded
 * `<img>` would be a broken image far more often than a face. The page is
 * where the photo lives, and the CTA is how the customer gets there.
 *
 * The window is repeated here because this is the first message after
 * confirmation that a customer is likely to act on, and "who is coming" and
 * "when" are one question.
 */
export function buildAgentAssignedEmail(input: AgentAssignedEmailInput): EmailMessage {
  const agent = input.agentGivenName ?? "Your Koolee agent";
  const body = [
    `Hi ${input.paxName},`,
    ``,
    `${agent} will be collecting your bags.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    `Pickup window: ${input.windowLabel}`,
    ``,
    `${agent} will check your ID at the door, weigh and seal each bag in front ` +
      `of you, and photograph every seal. Their photo is on your trip page so ` +
      `you know who to expect.`,
    ``,
    `If you haven't accepted our booking agreement yet, please do that on your ` +
      `trip page — ${agent} can't collect your bags until you have.`,
    ...(input.tripUrl ? [``, `See your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    `${agent} is on your pickup`,
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p><strong>${escapeHtml(agent)}</strong> will be collecting your bags.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong><br/>` +
      `Pickup window: <strong>${escapeHtml(input.windowLabel)}</strong></p>` +
      `<p>${escapeHtml(agent)} will check your ID at the door, weigh and seal each bag ` +
      `in front of you, and photograph every seal. Their photo is on your trip page ` +
      `so you know who to expect.</p>` +
      `<p>If you haven't accepted our booking agreement yet, please do that on your ` +
      `trip page — ${escapeHtml(agent)} can't collect your bags until you have.</p>`,
    input.tripUrl ? { label: "See your trip", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `${agent} is on your pickup — ${input.bookingRef}`,
    body,
    html,
  };
}

export interface BagsSealedEmailInput {
  to: string;
  bookingRef: string;
  paxName: string;
  bagCount: number;
  /** Printed seal ids, in bag order. Empty is tolerated, never faked. */
  sealIds: readonly string[];
  tripUrl?: string;
}

/**
 * "Your bags are sealed — now choose your driver."
 *
 * ONE EMAIL FOR TWO MATRIX ROWS, deliberately. The F2 matrix listed "bags
 * sealed — a summary" and "driver selectable — a link" as separate messages,
 * and they fire at the same instant: `verified_sealed` is both the moment the
 * last seal goes on and the moment the shortlist opens
 * (`DRIVER_SELECTABLE_STATUSES`). Two emails seconds apart would be a worse
 * product than one that says both things, so this says both.
 *
 * The seal ids are the point. They are the customer's evidence that the bag
 * that reaches the airline is the bag that left their door, and a summary that
 * omits them is just a status update.
 */
export function buildBagsSealedEmail(input: BagsSealedEmailInput): EmailMessage {
  const bags = `${input.bagCount} ${input.bagCount === 1 ? "bag" : "bags"}`;
  const sealLines =
    input.sealIds.length > 0
      ? input.sealIds.map((seal, i) => `  Bag ${i + 1}: ${seal}`)
      : [];

  const body = [
    `Hi ${input.paxName},`,
    ``,
    `Your ${bags} ${input.bagCount === 1 ? "is" : "are"} weighed, sealed and photographed.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    ...(sealLines.length > 0 ? [``, `Seal numbers:`, ...sealLines] : []),
    ``,
    `Next: choose your driver. Your trip page shows who's available, how far ` +
      `away they are, and how long they'll be. Once you pick, you can watch ` +
      `them come.`,
    ...(input.tripUrl ? [``, `Choose your driver: ${input.tripUrl}`] : []),
  ].join("\n");

  const sealHtml =
    input.sealIds.length > 0
      ? `<p>Seal numbers:<br/>` +
        input.sealIds
          .map((seal, i) => `Bag ${i + 1}: <strong>${escapeHtml(seal)}</strong>`)
          .join("<br/>") +
        `</p>`
      : "";

  const html = layout(
    "Your bags are sealed",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>Your ${escapeHtml(bags)} ${input.bagCount === 1 ? "is" : "are"} weighed, ` +
      `sealed and photographed.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      sealHtml +
      `<p>Next: choose your driver. Your trip page shows who's available, how far ` +
      `away they are, and how long they'll be. Once you pick, you can watch them come.</p>`,
    input.tripUrl ? { label: "Choose your driver", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `Bags sealed — choose your driver — ${input.bookingRef}`,
    body,
    html,
  };
}

export interface CustomerExceptionEmailInput {
  to: string;
  bookingRef: string;
  paxName: string;
  /** Where to write. Never a phone number we do not staff. */
  supportEmail: string;
  tripUrl?: string;
}

/**
 * "We've hit a snag, and we're on it."
 *
 * DELIBERATELY CARRIES NO REASON. `buildOpsExceptionEmail` gets the detail
 * because ops can act on it; this one does not, and that is the whole design:
 *
 *  - the internal reason is written for an operator ("ID mismatch", "customer
 *    not home", "capture failed after retry") and reads as an accusation, a
 *    confession, or gibberish depending on which one fired;
 *  - it can name staff, a payment provider, or an internal state; and
 *  - it is frequently WRONG in the first minute, because an exception is
 *    raised before anybody has looked.
 *
 * What a customer needs is that a human now owns their booking and will be in
 * touch. Anything more specific is a promise this email cannot keep.
 *
 * No CTA to a self-service action either — there is nothing for them to do —
 * so the only link is the trip page, and support is a plain address.
 */
export function buildCustomerExceptionEmail(
  input: CustomerExceptionEmailInput,
): EmailMessage {
  const body = [
    `Hi ${input.paxName},`,
    ``,
    `We've hit a snag with your Koolee pickup, and our team is on it.`,
    ``,
    `Booking reference: ${input.bookingRef}`,
    ``,
    `Someone will be in touch shortly with what happens next. You don't need ` +
      `to do anything right now — and if your plans have changed in the ` +
      `meantime, reply to this message or write to ${input.supportEmail} and ` +
      `we'll sort it out with you.`,
    ...(input.tripUrl ? [``, `Your trip page: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    "We've hit a snag with your pickup",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>We've hit a snag with your Koolee pickup, and our team is on it.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      `<p>Someone will be in touch shortly with what happens next. You don't need to ` +
      `do anything right now — and if your plans have changed in the meantime, reply ` +
      `to this message or write to ${escapeHtml(input.supportEmail)} and we'll sort ` +
      `it out with you.</p>`,
    input.tripUrl ? { label: "Your trip page", url: input.tripUrl } : undefined,
  );

  return {
    to: input.to,
    subject: `We're on it — ${input.bookingRef}`,
    body,
    html,
  };
}
