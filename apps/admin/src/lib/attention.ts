import type {
  BoardRow,
  LaunchReadiness,
  OpsDashboard,
  ReadinessItem,
  ShiftRow,
} from "@koolee/core";

/**
 * What actually needs a human right now — and nothing else.
 *
 * WHY THE OVERVIEW NEEDED THIS. The page was four stat cards, and on an
 * ordinary day three of them read `0`. A zero took exactly as much room as a
 * problem, so the shape of the page was identical whether everything was fine
 * or the fleet was on fire; the only difference was a digit. An operator
 * cannot scan that — they have to READ it, every time, to find out there is
 * nothing to do.
 *
 * So nothing that is fine appears at all. The page leads with a list that is
 * usually empty, and when it is empty it collapses to one line saying so.
 * Length becomes the signal: a long block means a bad morning, and you can
 * tell from across the room.
 *
 * SEVERITY IS THE ORDER, and it is a judgement about consequence rather than
 * about how alarming a word sounds:
 *
 *  1. **blocked** — Koolee cannot do its job at all. No pricing rule, no
 *     agreement. Nobody can buy anything, or every visit stops at a door.
 *  2. **urgent** — bags exist and something is wrong with them. An exception;
 *     a booking at risk of missing its cutoff.
 *  3. **soon** — work nobody has picked up yet. Unassigned, or sealed with no
 *     driver. Real, and not yet a failure.
 *
 * There is deliberately no fourth, quieter level. Anything true but not
 * actionable today — placeholder cutoffs, say — belongs to the readiness
 * block, not here; a panel that also carries things you are not going to do is
 * one somebody stops reading.
 *
 * Everything here is DERIVED from data the console already loads. No new
 * counters, no new tables — the standing rule is that a number kept in step
 * with what it counts is a number that eventually is not.
 */

export type AttentionLevel = "blocked" | "urgent" | "soon";

export interface AttentionItem {
  id: string;
  level: AttentionLevel;
  /** The problem, as a sentence somebody would say out loud. */
  title: string;
  /** What follows from it, when that is not obvious from the title. */
  detail?: string;
  /** Where the fix is. */
  href: string;
  /** The verb on the link. */
  action: string;
}

const LEVEL_ORDER: Record<AttentionLevel, number> = {
  blocked: 0,
  urgent: 1,
  soon: 2,
};

export function buildAttention(input: {
  dashboard: OpsDashboard;
  readiness: LaunchReadiness;
  /** Today's board rows, for the at-risk count. */
  today: readonly BoardRow[];
  /** Open shifts. An empty list with work outstanding is its own problem. */
  openShifts: readonly ShiftRow[];
}): AttentionItem[] {
  const { dashboard, readiness, today, openShifts } = input;
  const items: AttentionItem[] = [];

  /*
   * READINESS, BUT ONLY WHAT IS BLOCKED — never a `warn`.
   *
   * The first version raised placeholder cutoffs here too, as a quiet note.
   * On screen it was plainly wrong: the identical sentence appeared in this
   * panel AND three rows below in the readiness block, which is the panel
   * that exists to carry exactly that. Repeating a line does not make it more
   * urgent; it makes the panel look padded, which is the failing this whole
   * page was rebuilt to fix.
   *
   * The division is by TIME, not by severity: this panel is what somebody
   * does today, and unverified cutoffs are a job to finish before opening.
   * A BLOCKED item is different — no pricing rule means nobody can buy
   * anything right now — so it earns a place in both.
   */
  for (const item of readiness.items) {
    if (item.status !== "blocked") continue;
    items.push({
      id: `readiness:${item.key}`,
      level: "blocked",
      /*
       * Said the way a person would say it. `ReadinessItem.label` is a
       * CHECKLIST phrase — "Pricing rule active" — which reads correctly with
       * a tick beside it and badly as an alarm. The alarm is the absence.
       */
      title: blockedTitle(item.key),
      ...(item.detail ? { detail: item.detail } : {}),
      href: item.href,
      action: "Fix",
    });
  }

  if (dashboard.exceptionsOpen > 0) {
    items.push({
      id: "exceptions",
      level: "urgent",
      title: `${dashboard.exceptionsOpen} booking${dashboard.exceptionsOpen === 1 ? "" : "s"} stopped`,
      detail: "Ops owns these until somebody resolves them.",
      href: "/exceptions",
      action: "Review",
    });
  }

  const atRisk = today.filter((row) => row.atRisk).length;
  if (atRisk > 0) {
    items.push({
      id: "at-risk",
      level: "urgent",
      title: `${atRisk} at risk today`,
      detail: "Missing an agent or a driver close enough to the window to matter.",
      href: "/bookings?today=1",
      action: "Open board",
    });
  }

  if (dashboard.unassignedToday > 0) {
    items.push({
      id: "unassigned",
      level: "soon",
      title: `${dashboard.unassignedToday} paid today with no agent`,
      href: "/bookings?status=paid&today=1",
      action: "Assign",
    });
  }

  if (dashboard.awaitingDriverToday > 0) {
    items.push({
      id: "no-driver",
      level: "soon",
      /*
       * NOT phrased as a failure. The overwhelmingly likeliest explanation is
       * that the customer has not chosen their driver yet, which needs nobody.
       * It becomes ops' problem only when nobody is on shift to be chosen —
       * which is the next item, and why they are separate.
       */
      title: `${dashboard.awaitingDriverToday} sealed, waiting on a driver`,
      detail: "Usually the customer choosing. Check the board if it lingers.",
      href: "/bookings?today=1",
      action: "Open board",
    });
  }

  /*
   * NOBODY ON SHIFT, while there is sealed work waiting. Either alone is
   * ordinary — an empty road at 6am is fine, and a sealed booking mid-morning
   * is fine — and together they are the one shape where a customer's bags sit
   * on a doorstep with literally nobody who could be chosen to collect them.
   */
  if (openShifts.length === 0 && dashboard.awaitingDriverToday > 0) {
    items.push({
      id: "no-shifts",
      level: "urgent",
      title: "Nobody is on shift",
      detail: "Sealed bags are waiting and there is no driver for a customer to pick.",
      href: "/shifts",
      action: "Start a shift",
    });
  }

  return items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** The absence, stated. */
function blockedTitle(key: ReadinessItem["key"]): string {
  switch (key) {
    case "pricing":
      return "No pricing rule is active";
    case "agreement":
      return "No booking agreement is published";
    case "cutoffs":
      return "No airline cutoffs on record";
    case "staff":
      return "No active staff";
  }
}
