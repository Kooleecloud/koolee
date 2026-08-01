import { date, index, pgTable, uuid, varchar } from "drizzle-orm/pg-core";

import { createdAt, primaryId, updatedAt } from "./columns";
import { routeStatusEnum, type AirportCode } from "./enums";
import { airports } from "./airports";
import { drivers } from "./identity";

/** A driver's run for one day to one airport. */
export const routes = pgTable(
  "routes",
  {
    id: primaryId(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    /** Local operating date — a route belongs to a day, not an instant. */
    date: date("date").notNull(),
    airportCode: varchar("airport_code", { length: 3 })
      .$type<AirportCode>()
      .notNull()
      .references(() => airports.code, { onDelete: "restrict" }),
    status: routeStatusEnum("status").notNull().default("planned"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("routes_driver_date_idx").on(t.driverId, t.date),
    index("routes_date_airport_idx").on(t.date, t.airportCode),
    index("routes_status_idx").on(t.status),
  ],
);

export type Route = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;
