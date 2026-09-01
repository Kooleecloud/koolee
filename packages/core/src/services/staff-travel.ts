import { eq } from "drizzle-orm";
import { driverPositions } from "@koolee/db";

import type { CoreConfig } from "../config";
import {
  formatMiles,
  haversineKm,
  toCoordinates,
  type Coordinates,
} from "../geo/coordinates";
import { formatEtaMinutes } from "../geo/eta";

/**
 * How far a staff member is from the door they are heading to, and how long it
 * will take.
 *
 * WHY THE AGENT APP NEEDED THIS. The doorstep card told a driver WHERE the
 * door was and never how far away it was — which is the first thing somebody
 * about to set off asks, and the thing they re-check at every light. The
 * customer's page has had a distance and an ETA since the driver-selection
 * slice; the person actually driving had neither.
 *
 * IT READS THEIR OWN LAST PING. `driver_positions` holds one mutable row per
 * staff member, written every 20–45 seconds by the agent app's `GpsPinger` while
 * a pickup is under way. That is a foreground-only ping, so a phone in a
 * pocket stops reporting and this goes quiet — which is honest, and better
 * than a stale position presented as current.
 *
 * NOTHING IS LOAD-BEARING. Null is an ordinary answer — location off, no fix
 * yet, an address with no coordinates — and every caller renders nothing
 * rather than a placeholder. Never throws: a driver standing at a door must
 * not meet a 500 because a routing API is down (the estimator seam already
 * falls back to arithmetic on its own).
 */

export interface StaffTravel {
  /** "3.2 miles away", customer-facing units. */
  distanceLabel: string;
  /** "about 15 min", or "Locating…" when there is no position to measure from. */
  etaLabel: string;
  /** The two, joined — what the agent card renders. */
  label: string;
}

export async function staffTravelToDoor(
  config: CoreConfig,
  input: { staffUserId: string; destination: Coordinates | null },
): Promise<StaffTravel | null> {
  if (input.destination === null) return null;

  let from: Coordinates | null;
  try {
    const [row] = await config.db
      .select({ lat: driverPositions.lat, lng: driverPositions.lng })
      .from(driverPositions)
      .where(eq(driverPositions.staffUserId, input.staffUserId))
      .limit(1);
    from = toCoordinates(row?.lat, row?.lng);
  } catch {
    // A card that renders one line less is fine; one that 500s is not.
    return null;
  }
  if (from === null) return null;

  const distanceLabel = `${formatMiles(haversineKm(from, input.destination))} away`;

  let etaLabel: string;
  try {
    etaLabel = formatEtaMinutes(
      await config.etaEstimator.estimate({ from, to: input.destination }),
    );
  } catch {
    // The Routes adapter already degrades to arithmetic internally, so this
    // only catches something genuinely unexpected. The distance still stands.
    etaLabel = formatEtaMinutes(null);
  }

  return { distanceLabel, etaLabel, label: `${distanceLabel} · ${etaLabel}` };
}
