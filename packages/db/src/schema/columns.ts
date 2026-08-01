import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Column helpers so every table agrees on the boring parts.
 *
 * Two hard conventions:
 *  - all PKs are uuid, defaulted by Postgres via `gen_random_uuid()`;
 *  - every point in time is `timestamptz`. Koolee reasons about airline
 *    cutoffs across DST boundaries; a naive timestamp anywhere is a bug.
 */

export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
