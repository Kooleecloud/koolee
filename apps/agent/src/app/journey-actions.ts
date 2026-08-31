"use server";

import { revalidatePath } from "next/cache";
import { startPickupTravel } from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";

/**
 * Starting a pickup leg from the journey list, by tapping Navigate.
 *
 * WHY "SET OFF" IS NOT A SEPARATE BUTTON ANY MORE — and why it is still an
 * explicit tap.
 *
 * The driver already taps Navigate: it is how they get directions, and they
 * take that action at precisely the moment they set off. Asking them to tap a
 * second, purely administrative button immediately afterwards is a step that
 * exists for the database's benefit rather than theirs, and steps like that
 * get skipped — which strands the customer on "Live tracking starts when your
 * driver sets off" while a van is already outside their building.
 *
 * The alternative considered and REJECTED was inferring departure from GPS.
 * Three reasons: the agent app's location is foreground-only, so on an
 * installed PWA (iOS especially) the signal would silently never fire for many
 * drivers; "moving toward the customer" is genuinely ambiguous when a driver
 * has several stops aboard and one-way streets to work with; and
 * `startPickupTravel` writes a CUSTODY EVENT — in a chain-of-custody product,
 * replacing a person's assertion with a heuristic's guess weakens the record
 * exactly where it matters most.
 *
 * So the signal stays deliberate and human. It is simply attached to the
 * action the driver was taking anyway.
 *
 * NO GPS HERE, deliberately. Reading a position takes seconds and a permission
 * prompt, and this fires while the driver is opening their maps app — a
 * navigation that waits on a geolocation callback is a navigation the browser
 * may refuse to make. The custody event records WHO and WHEN without WHERE;
 * the guided pickup flow's own "Set off" control still captures coordinates
 * when it is the path taken.
 *
 * IT NEVER BLOCKS THE MAP. The caller fires this and opens directions
 * regardless of the outcome — see `NavigateAction`. `startPickupTravel` is
 * idempotent in core (a task already started returns `ok`), so a second tap,
 * or a tap after the guided flow already started the leg, is harmless.
 */
export interface StartPickupResult {
  ok: boolean;
  error?: string;
}

export async function startPickupFromJourney(
  taskId: string,
): Promise<StartPickupResult> {
  if (!taskId) return { ok: false, error: "Missing task." };

  try {
    const session = await requireAgentSession();
    const result = await startPickupTravel(getCore(), session, { taskId });
    if (!result.ok) return { ok: false, error: result.error };

    // Both surfaces that render the leg's state: the journey list is where the
    // tap happened, and the guided flow is where the driver lands next.
    revalidatePath("/");
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    // Swallowed into a result rather than thrown: the driver is mid-tap with a
    // maps app opening over the top of this, and an unhandled rejection there
    // helps nobody. The leg simply stays un-started and the guided flow's own
    // "Set off" still works.
    console.error("[journey] startPickupFromJourney failed", error);
    return { ok: false, error: "Couldn't start the pickup." };
  }
}
