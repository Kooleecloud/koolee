import { count, eq, sql } from "drizzle-orm";
import { airlineCutoffs, pricingRules, staffMembers, type Database } from "@koolee/db";

import { PLACEHOLDER_SOURCE_PREFIX } from "./airline-cutoffs";
import { countAgreementVersions } from "./agreements";

/**
 * Can Koolee sell right now, and if not, what is missing?
 *
 * WHY THIS IS A DOMAIN QUESTION AND NOT A PAGE. Each of these is a condition
 * under which the product silently stops working, and each is invisible from
 * every other surface:
 *
 *  - **No active pricing rule** and `resolveQuote` refuses every quote. The
 *    funnel shows a price step that cannot price. Nothing errors.
 *  - **No published agreement version** and the identity gate fails closed:
 *    no booking can hold an acceptance, so every agent visit stops at the
 *    door. Deliberately not a boot gate — a day-zero deploy has to come up
 *    before v1 can be written in it — so a screen has to raise it instead.
 *  - **Unverified cutoffs** are invented numbers deciding whether a pickup can
 *    make its flight. The seed writes 128 placeholder rows at 45/60 minutes;
 *    until they are replaced Koolee is selling against a guess.
 *  - **No active staff** and nobody can be assigned to anything.
 *
 * THE ORDER IS SEVERITY, and it is the order the console renders. A missing
 * pricing rule stops money; a missing agreement stops every doorstep;
 * placeholder cutoffs are wrong rather than absent, which is worse in a
 * different way but not immediately.
 *
 * IT IS NOT THE LAUNCH CHECKLIST. `docs/LAUNCH-CHECKLIST.md` tracks the whole
 * opening, including things no query can see (Stripe live mode, legal review,
 * a verified sending domain). This is only the subset the DATABASE can answer,
 * which is exactly the subset a screen should be checking rather than a human
 * remembering.
 */

export type ReadinessStatus = "ok" | "warn" | "blocked";

export interface ReadinessItem {
  key: "pricing" | "agreement" | "cutoffs" | "staff";
  /** What it is, in the console's voice. */
  label: string;
  status: ReadinessStatus;
  /** The consequence, present tense, only when it is not `ok`. */
  detail: string | null;
  /** Where to go and fix it. */
  href: string;
}

export interface LaunchReadiness {
  items: ReadinessItem[];
  /** True when every item is `ok` — the console hides the whole block. */
  ready: boolean;
  /** For the "3 of 4" summary. */
  okCount: number;
}

export async function getLaunchReadiness(db: Database): Promise<LaunchReadiness> {
  const [activeRule, agreementVersions, cutoffs, activeStaff] = await Promise.all([
    db.query.pricingRules.findFirst({ where: eq(pricingRules.active, true) }),
    countAgreementVersions(db),
    /*
     * Counted in SQL rather than by listing 128 rows and filtering them in
     * memory, which is what `listAirlineCutoffs` does for the page that
     * renders them all. A number does not need the rows.
     *
     * The predicate MIRRORS `isPlaceholderCutoff` — leading whitespace
     * trimmed, then a prefix match — because two definitions of "is this
     * verified" is how the console's count and the console's page come to
     * disagree about the same 128 rows.
     */
    db
      .select({
        total: count(),
        placeholders: sql<number>`count(*) filter (
          where ltrim(coalesce(${airlineCutoffs.source}, '')) like ${PLACEHOLDER_SOURCE_PREFIX + "%"}
        )::int`,
      })
      .from(airlineCutoffs),
    db.select({ total: count() }).from(staffMembers).where(eq(staffMembers.active, true)),
  ]);

  const cutoffTotal = Number(cutoffs[0]?.total ?? 0);
  const cutoffPlaceholders = Number(cutoffs[0]?.placeholders ?? 0);
  const staffCount = Number(activeStaff[0]?.total ?? 0);

  const items: ReadinessItem[] = [
    {
      key: "pricing",
      label: "Pricing rule active",
      status: activeRule ? "ok" : "blocked",
      detail: activeRule ? null : "Every quote is refusing right now.",
      href: "/pricing",
    },
    {
      key: "agreement",
      label: "Booking agreement published",
      status: agreementVersions > 0 ? "ok" : "blocked",
      detail:
        agreementVersions > 0
          ? null
          : "No version exists, so every agent visit stops at the identity gate.",
      href: "/agreements",
    },
    {
      key: "cutoffs",
      label: "Airline cutoffs verified",
      status: cutoffTotal === 0 ? "blocked" : cutoffPlaceholders > 0 ? "warn" : "ok",
      detail:
        cutoffTotal === 0
          ? "No cutoffs on record — Koolee refuses to sell any airline."
          : cutoffPlaceholders > 0
            ? `${cutoffPlaceholders} of ${cutoffTotal} are still the seed's invented numbers.`
            : null,
      href: "/cutoffs",
    },
    {
      key: "staff",
      label: "Active staff",
      status: staffCount > 0 ? "ok" : "blocked",
      detail: staffCount > 0 ? null : "Nobody can be assigned to a booking.",
      href: "/staff",
    },
  ];

  const okCount = items.filter((item) => item.status === "ok").length;
  return { items, ready: okCount === items.length, okCount };
}
