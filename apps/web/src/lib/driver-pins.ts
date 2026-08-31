import type { MapDriver } from "@koolee/ui";

/** The fields a pin needs off a shortlist row. */
export interface PinnableCandidate {
  shiftId: string;
  givenName: string | null;
  position: { lat: number; lng: number } | null;
}

/**
 * Turns a driver shortlist into map pins.
 *
 * A FUNCTION RATHER THAN THREE LINES INSIDE THE COMPONENT, because two of its
 * rules are easy to get wrong in a way nothing would catch:
 *
 *  - **A driver with no position gets no pin, and keeps their card.** `null`
 *    is ordinary — a phone in a pocket stops reporting — and it is not a
 *    reason to stop offering somebody who is perfectly choosable. Dropping
 *    them from the LIST would hide a driver; drawing them at a made-up
 *    coordinate would put a van on a street it has never been on. Neither is
 *    better than a card without a pin.
 *  - **The pin's id is the SHIFT id**, which is also the selection target and
 *    the reconciliation key `LiveMap` moves markers by. A different id here
 *    would make every refresh tear the pin down and re-add it, which is the
 *    difference between a van that drives and a van that blinks.
 *
 * `selectedShiftId` is the open card, not a booking: nothing is chosen until
 * a form is submitted.
 */
export function driverPins(
  candidates: readonly PinnableCandidate[],
  selectedShiftId: string | null,
): MapDriver[] {
  const pins: MapDriver[] = [];
  for (const candidate of candidates) {
    if (candidate.position === null) continue;
    pins.push({
      id: candidate.shiftId,
      position: candidate.position,
      label: candidate.givenName,
      selected: candidate.shiftId === selectedShiftId,
    });
  }
  return pins;
}
