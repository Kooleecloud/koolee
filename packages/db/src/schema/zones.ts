import { index, pgTable, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { createdAt, primaryId } from "./columns";
import { users } from "./identity";

/**
 * Which ZIPs an agent covers — the only input auto-assignment has beyond
 * workload.
 *
 * Flat agent × ZIP rows rather than a named-zone entity. A zone table would
 * add a join and a second thing to keep in sync for no gain at NYC scale, and
 * the service boundary itself is already a reviewable ZIP allowlist
 * (`coverage/nyc-zips.ts` in @koolee/core). If territories ever get names and
 * shifts of their own, that is the migration to write then.
 *
 * A ZIP with no agent is not an error: coverage says Koolee sells there,
 * this table says who is working it today. An uncovered pickup falls through
 * to manual assignment in the console rather than blocking the sale.
 */
export const agentZones = pgTable(
  "agent_zones",
  {
    id: primaryId(),
    agentUserId: uuid("agent_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Five-digit US ZIP, matched against the pickup address. */
    zip: varchar("zip", { length: 10 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One row per pair: assigning the same ZIP twice would double-weight the
    // agent in any future coverage count.
    uniqueIndex("agent_zones_agent_zip_key").on(t.agentUserId, t.zip),
    // The lookup auto-assign runs: "who covers this ZIP".
    index("agent_zones_zip_idx").on(t.zip),
  ],
);

export type AgentZone = typeof agentZones.$inferSelect;
export type NewAgentZone = typeof agentZones.$inferInsert;
