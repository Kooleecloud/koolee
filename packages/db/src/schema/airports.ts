import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { AIRPORT_CODES, cutoffScopeEnum, type AirportCode } from "./enums";

/**
 * Airports are keyed by IATA code rather than a surrogate uuid — the code is
 * already a stable natural key and it makes every FK readable in raw SQL.
 *
 * A CHECK (not a pgEnum) constrains the value: adding a fourth airport is then
 * an ordinary DDL statement rather than `ALTER TYPE ... ADD VALUE`, which
 * cannot run inside a transaction on older Postgres.
 */
export const airports = pgTable(
  "airports",
  {
    code: varchar("code", { length: 3 }).$type<AirportCode>().primaryKey(),
    name: text("name").notNull(),
    /** IANA timezone, e.g. "America/New_York". */
    tz: text("tz").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // sql.raw, not interpolation: a bound parameter inside DDL would emit
    // `in ($1, $2, $3)` into the migration file, which Postgres rejects.
    check(
      "airports_code_check",
      sql`${t.code} in (${sql.raw(AIRPORT_CODES.map((c) => `'${c}'`).join(", "))})`,
    ),
  ],
);

/**
 * How long before departure an airline stops accepting checked bags at a given
 * airport. This is the single most safety-critical row in the database: every
 * sellable pickup slot is derived from it.
 *
 * `source` records provenance (airline website URL, ops phone call, contract)
 * and `effective_from` lets us keep history rather than mutating in place.
 */
export const airlineCutoffs = pgTable(
  "airline_cutoffs",
  {
    id: primaryId(),
    airlineIata: varchar("airline_iata", { length: 3 }).notNull(),
    airportCode: varchar("airport_code", { length: 3 })
      .$type<AirportCode>()
      .notNull()
      .references(() => airports.code, { onDelete: "restrict" }),
    scope: cutoffScopeEnum("scope").notNull(),
    cutoffMinutesBeforeDeparture: integer("cutoff_minutes_before_departure").notNull(),
    source: text("source"),
    effectiveFrom: timestamptz("effective_from").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("airline_cutoffs_airline_airport_scope_key").on(
      t.airlineIata,
      t.airportCode,
      t.scope,
    ),
    index("airline_cutoffs_airport_idx").on(t.airportCode),
  ],
);

export type Airport = typeof airports.$inferSelect;
export type NewAirport = typeof airports.$inferInsert;
export type AirlineCutoff = typeof airlineCutoffs.$inferSelect;
export type NewAirlineCutoff = typeof airlineCutoffs.$inferInsert;
