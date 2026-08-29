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
function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
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
    ...(input.tripUrl ? [``, `Track your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const priceRows = [...input.priceLines, { label: "Total", amountCents: input.totalCents }]
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
      `deliver them to your airline's bag drop. You travel to the airport hands-free.</p>`,
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
    `Please have your ${bags} packed and your photo ID ready. We'll seal your ` +
      `bags in front of you and deliver them to your airline's bag drop.`,
    ...(input.tripUrl ? [``, `Track your trip: ${input.tripUrl}`] : []),
  ].join("\n");

  const html = layout(
    "Your pickup window is coming up",
    `<p>Hi ${escapeHtml(input.paxName)},</p>` +
      `<p>Your Koolee pickup window is coming up: <strong>${escapeHtml(input.windowLabel)}</strong>.</p>` +
      `<p>Booking reference: <strong>${escapeHtml(input.bookingRef)}</strong></p>` +
      `<p>Please have your ${escapeHtml(bags)} packed and your photo ID ready. We'll seal your ` +
      `bags in front of you and deliver them to your airline's bag drop.</p>`,
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
  const label = input.bookingRef ? `${input.bookingRef} (${input.bookingId})` : input.bookingId;
  const body = [
    `Booking ${label} entered the exception state.`,
    ``,
    `Reason: ${input.reason}`,
    ...(input.raisedByUserId ? [`Raised by: ${input.raisedByUserId}`] : [`Raised by: system`]),
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
