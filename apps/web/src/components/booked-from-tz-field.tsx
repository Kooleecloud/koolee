"use client";

import { useEffect, useRef } from "react";

/**
 * Records the zone the customer was in when they booked.
 *
 * METADATA, NOT DISPLAY. The booking is rendered in the departure airport's
 * zone for everyone — customer, agent, and ops alike — and this value must
 * never feed a formatter. It exists so support can answer "did they read 10 AM
 * as their own time?", so reminders are not sent at 4 AM local, and so the
 * "all times are local to JFK" line can be shown to the customers who actually
 * need it instead of to everyone.
 *
 * Hidden and filled after mount rather than read server-side, because the
 * server genuinely cannot know this — and a guess from an IP or an
 * Accept-Language header would be worse than the empty string. An empty value
 * is a fine outcome: `createBooking` sanitizes it and stores null.
 */
export function BookedFromTzField() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (ref.current && tz) ref.current.value = tz;
    } catch {
      // Hardened browsers can throw here. The field stays empty and the
      // booking proceeds — this is never worth failing a purchase over.
    }
  }, []);

  return <input ref={ref} type="hidden" name="bookedFromTz" defaultValue="" />;
}
