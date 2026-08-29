import { Navigation, Phone } from "lucide-react";
import { Button, formatE164ForDisplay } from "@koolee/ui";
import type { TaskBookingContext } from "@koolee/core";

import { addressText, mapsUrl } from "@/lib/job";

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
 */
export function JobActions({
  booking,
  size = "default",
}: {
  booking: TaskBookingContext;
  /** `lg` on the visit screen, where these are the primary controls. */
  size?: "default" | "lg";
}) {
  const phone = booking.contactPhone;

  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size={size} className="flex-1">
        <a href={mapsUrl(booking)} target="_blank" rel="noopener noreferrer">
          <Navigation aria-hidden="true" />
          Navigate
        </a>
      </Button>
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
