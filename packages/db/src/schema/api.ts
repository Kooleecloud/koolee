import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  varchar,
} from "drizzle-orm/pg-core";
import { uuid } from "drizzle-orm/pg-core";

import { createdAt, timestamptz } from "./columns";
import { users } from "./identity";

/**
 * Idempotency keys for the agent app's `/api/v1` routes.
 *
 * WHY. The native driver app queues actions while offline and replays them
 * in order when the network returns. A replay is a repeat of a request whose
 * first attempt may or may not have landed — the phone only knows the
 * response never arrived. Some core steps are idempotent by design (the whole
 * pickup run), several are not (sealing a bag twice is a `ConflictError`,
 * starting a shift twice is a refusal), and a refusal on replay would tell the
 * driver a step failed that in fact succeeded. So every mutating route takes
 * an `Idempotency-Key` header and the FIRST completed response is stored
 * here; a repeat with the same key gets that response back verbatim.
 *
 * ONE ROW PER (USER, KEY). The key is minted by the device (a uuid), scoped
 * by the user so two drivers can never collide, and paired with a hash of the
 * route + body so the same key cannot be reused for a different request.
 *
 * NOT EVIDENCE. Rows are pruned after `IDEMPOTENCY_RETENTION_HOURS` (core)
 * by the hourly Inngest sweep — long past any realistic replay window. A
 * request that failed server-side (5xx) deletes its row so the next attempt
 * runs for real.
 */
export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Device-minted, opaque. Capped so a hostile client cannot bloat the row. */
    key: varchar("key", { length: 128 }).notNull(),
    /** `METHOD /path`, so a key replayed against another route is a mismatch. */
    route: text("route").notNull(),
    /** sha256 of the canonical request body. */
    requestHash: text("request_hash").notNull(),
    /** HTTP status of the stored response. Null while the first attempt is in flight. */
    status: integer("status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    createdAt: createdAt(),
    completedAt: timestamptz("completed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("api_idempotency_keys_created_at_idx").on(t.createdAt),
  ],
);

export type ApiIdempotencyKey = typeof apiIdempotencyKeys.$inferSelect;
export type NewApiIdempotencyKey = typeof apiIdempotencyKeys.$inferInsert;
