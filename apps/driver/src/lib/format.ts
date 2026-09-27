import { Linking } from "react-native";

/**
 * Small display helpers ported from `@koolee/ui/lib/phone` and core's
 * `services/door-contact`, plus the two ways a job card leaves the app:
 * opening the maps link and dialling the door number. Pure except for the
 * last two, which only touch `Linking`.
 */

export function formatUsPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A stored E.164 number, rendered the way a person reads it aloud.
 *
 * Anything that is not an unambiguous US number is returned untouched. That
 * matters more than it looks: without the `+` guard, a truncated
 * "+1212555010" formats as "(121) 255-5010", a plausible number that is not
 * the customer's — on screens whose whole purpose is that somebody dials it.
 */
export function formatE164ForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+1") && digits.length === 11)
    return formatUsPhone(digits.slice(1));
  if (!value.startsWith("+") && digits.length === 10) return formatUsPhone(digits);
  return value;
}

export interface DoorContact {
  phone: string;
  /**
   * Where it came from. `booking` was given for this pickup specifically;
   * `account` is the customer's verified number. The app does not branch on
   * this — it exists so a support conversation can tell the two apart.
   */
  source: "booking" | "account";
}

/**
 * The number the person at the door can be reached on.
 *
 * The booking's own `contactPhone` wins when present: an email-only customer
 * typed it FOR this pickup, and it may be a different number from any on the
 * account (a hotel desk, the person actually home). Otherwise the customer's
 * verified number. Null is a real state — an email-only customer who reached
 * a booking without a door number — and the screen says so rather than
 * pretending.
 */
export function doorContact(
  booking: { contactPhone: string | null },
  customer: { phone?: string | null } | null,
): DoorContact | null {
  const onBooking = booking.contactPhone?.trim();
  if (onBooking) return { phone: onBooking, source: "booking" };

  const onAccount = customer?.phone?.trim();
  if (onAccount) return { phone: onAccount, source: "account" };

  return null;
}

/**
 * Hands the maps link to the OS. Resolves false when nothing on the phone
 * could take it, so the screen can say so instead of tapping into silence.
 */
export async function openMaps(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn("[format] could not open maps", error);
    return false;
  }
}

/** Opens the dialler on the number. Same contract as `openMaps`. */
export async function callPhone(phone: string): Promise<boolean> {
  try {
    await Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
    return true;
  } catch (error) {
    console.warn("[format] could not open the dialler", error);
    return false;
  }
}
