import type { User } from "@koolee/db";

/**
 * "Is this profile finished?", answered in one place.
 *
 * WHAT COUNTS, and what deliberately does not.
 *
 * Four things, and every one of them is about US being able to reach or
 * recognise this person:
 *
 *  - a **verified phone**, which is how a driver reaches somebody standing in
 *    a lobby with three bags;
 *  - a **verified email**, which is where every booking record goes;
 *  - a **display name**, so an agent at a door can greet a person rather than
 *    a booking reference;
 *  - a **photo**, so the person at the door and the person opening it can
 *    recognise each other.
 *
 * WHAT IS NOT HERE, and this is the important half: accepting the booking
 * agreement and pre-uploading a passport are **per-booking**, not per-profile.
 * They pin to a booking (`agreement_acceptances` is UNIQUE on `booking_id`),
 * they expire with it, and a customer with three trips has three separate
 * answers. Putting them in a profile checklist would make a finished profile
 * un-finishable — every new booking would un-complete it — and would tell
 * somebody with one outstanding agreement that their PROFILE is incomplete,
 * which is not true and not actionable where the card lives. Those prompts
 * belong on the trip, driven by `services/trips.ts`.
 *
 * A PURE FUNCTION over a user row, so the rule is provable without a database
 * and every surface that asks gets the same answer.
 */

/** One thing still missing, in the order a person should be asked for it. */
export type ProfileGap =
  | "verify_phone"
  | "verify_email"
  | "add_name"
  | "add_photo";

export interface ProfileCompleteness {
  complete: boolean;
  /** Exactly what is missing, in ask-order. Empty when complete. */
  missing: ProfileGap[];
}

/** Everything the answer depends on, and nothing else. */
export type ProfileSubject = Pick<
  User,
  "phone" | "phoneVerifiedAt" | "email" | "emailVerifiedAt" | "fullName" | "avatarStoragePath"
>;

export function profileCompleteness(user: ProfileSubject | null): ProfileCompleteness {
  const missing: ProfileGap[] = [];

  // A number on file that was never verified is worth nothing operationally —
  // it is exactly as useful as no number when a driver is at the kerb — so
  // the gap is "verify", never "add", and both cases produce the same item.
  if (!user?.phone || !user.phoneVerifiedAt) missing.push("verify_phone");
  if (!user?.email || !user.emailVerifiedAt) missing.push("verify_email");
  if (!user?.fullName?.trim()) missing.push("add_name");
  if (!user?.avatarStoragePath) missing.push("add_photo");

  return { complete: missing.length === 0, missing };
}
