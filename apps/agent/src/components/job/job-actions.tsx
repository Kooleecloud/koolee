import { Phone } from "lucide-react";
import { Button, formatE164ForDisplay } from "@koolee/ui";
import { doorContact, type TaskBookingContext } from "@koolee/core";

import { addressText, mapsUrl } from "@/lib/job";

import { NavigateAction } from "./navigate-action";

/**
 * Navigate and Call — the two things a driver does with a job that are not
 * inside the app.
 *
 * These exist because the previous build printed an address as plain text and
 * hid the phone number in a card description. Both are the reason the driver
 * is holding the phone: one gets them to the door, the other gets them
 * through it. Typing an address into Maps from memory, at the wheel, is the
 * failure this replaces.
 *
 * Full-width and side by side so either is a thumb-sized target, and both open
 * out of the app rather than into a screen the driver then has to leave.
 *
 * Navigate does double duty on a startable pickup — see `NavigateAction`. The
 * driver taps it at the moment they set off, which is exactly when the leg
 * should start, so there is no second administrative button.
 */
export function JobActions({
  booking,
  size = "default",
  /**
   * The pickup task this stop would start, or null. Passed down rather than
   * derived here: only the caller knows which phase is next.
   */
  startsPickupTaskId = null,
}: {
  booking: TaskBookingContext;
  /** `lg` on the visit screen, where these are the primary controls. */
  size?: "default" | "lg";
  startsPickupTaskId?: string | null;
}) {
  // Resolved, not read raw: `contactPhone` is only ever set for email-only
  // customers, which is why most jobs used to show a disabled "No number"
  // while the customer's verified number sat on their account. See
  // `doorContact` for what is granted here and what still is not.
  const contact = doorContact(booking, { phone: booking.customerPhone });
  const phone = contact?.phone ?? null;

  return (
    <div className="flex gap-2">
      <NavigateAction
        href={mapsUrl(booking)}
        startsPickupTaskId={startsPickupTaskId}
        size={size}
        className="flex-1"
      />
      {phone ? (
        <Button asChild variant="outline" size={size} className="flex-1">
          <a href={`tel:${phone}`}>
            <Phone aria-hidden="true" />
            Call
          </a>
        </Button>
      ) : (
        /* Not hidden: a driver needs to know the absence is the record's, not
           a loading state, before they start looking for another way in. */
        <Button variant="outline" size={size} className="flex-1" disabled>
          <Phone aria-hidden="true" />
          No number
        </Button>
      )}
      <span className="sr-only">
        {addressText(booking)}
        {phone ? `, ${formatE164ForDisplay(phone)}` : ", no contact number on file"}
      </span>
    </div>
  );
}
