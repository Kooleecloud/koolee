import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId } from "./columns";
import { userRoleEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    /** E.164. Primary identifier — customers sign in with phone OTP. */
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 320 }),
    fullName: text("full_name"),
    role: userRoleEnum("role").notNull().default("customer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_phone_key").on(t.phone), index("users_role_idx").on(t.role)],
);

export const addresses = pgTable(
  "addresses",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    zip: varchar("zip", { length: 10 }).notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Google Places ID, when the address came from autocomplete. */
    placeId: text("place_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("addresses_user_id_idx").on(t.userId),
    index("addresses_zip_idx").on(t.zip),
  ],
);

/** A Koolee check-in agent: verifies ID, weighs, seals, photographs. */
export const agents = pgTable(
  "agents",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    phone: varchar("phone", { length: 20 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agents_user_id_key").on(t.userId),
    index("agents_active_idx").on(t.active),
  ],
);

/** A driver who delivers sealed bags to the airline's bag drop. */
export const drivers = pgTable(
  "drivers",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    phone: varchar("phone", { length: 20 }),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleColor: text("vehicle_color"),
    vehiclePlate: varchar("vehicle_plate", { length: 16 }),
    /** How many bags this vehicle can carry in one run. */
    vehicleCapacityBags: doublePrecision("vehicle_capacity_bags"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("drivers_user_id_key").on(t.userId),
    index("drivers_active_idx").on(t.active),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
