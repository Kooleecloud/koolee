import { relations } from "drizzle-orm";

import { airlineCutoffs, airports } from "./airports";
import { payments, pricingRules } from "./billing";
import { bags, bookings } from "./bookings";
import { bookingDrafts } from "./drafts";
import { custodyEvents } from "./custody";
import { addresses, agents, drivers, users } from "./identity";
import { routes } from "./ops";
import { slots } from "./slots";
import { pickupTasks, verificationTasks } from "./tasks";

/**
 * Relations are declared here rather than beside each table so the table files
 * stay free of circular imports.
 */

export const usersRelations = relations(users, ({ many, one }) => ({
  addresses: many(addresses),
  bookings: many(bookings),
  bookingDraft: one(bookingDrafts),
  agent: one(agents),
  driver: one(drivers),
}));

export const bookingDraftsRelations = relations(bookingDrafts, ({ one }) => ({
  user: one(users, { fields: [bookingDrafts.userId], references: [users.id] }),
}));

export const addressesRelations = relations(addresses, ({ one, many }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
  bookings: many(bookings),
}));

export const agentsRelations = relations(agents, ({ one }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
}));

export const driversRelations = relations(drivers, ({ one, many }) => ({
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
  routes: many(routes),
}));

export const airportsRelations = relations(airports, ({ many }) => ({
  cutoffs: many(airlineCutoffs),
  slots: many(slots),
  routes: many(routes),
  departures: many(bookings),
}));

export const airlineCutoffsRelations = relations(airlineCutoffs, ({ one }) => ({
  airport: one(airports, {
    fields: [airlineCutoffs.airportCode],
    references: [airports.code],
  }),
}));

export const slotsRelations = relations(slots, ({ one, many }) => ({
  airport: one(airports, {
    fields: [slots.airportCode],
    references: [airports.code],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  pickupAddress: one(addresses, {
    fields: [bookings.pickupAddressId],
    references: [addresses.id],
  }),
  airport: one(airports, {
    fields: [bookings.departureAirport],
    references: [airports.code],
  }),
  slot: one(slots, { fields: [bookings.slotId], references: [slots.id] }),
  bags: many(bags),
  custodyEvents: many(custodyEvents),
  payments: many(payments),
  verificationTasks: many(verificationTasks),
  pickupTasks: many(pickupTasks),
}));

export const bagsRelations = relations(bags, ({ one, many }) => ({
  booking: one(bookings, { fields: [bags.bookingId], references: [bookings.id] }),
  custodyEvents: many(custodyEvents),
}));

export const custodyEventsRelations = relations(custodyEvents, ({ one }) => ({
  booking: one(bookings, {
    fields: [custodyEvents.bookingId],
    references: [bookings.id],
  }),
  bag: one(bags, { fields: [custodyEvents.bagId], references: [bags.id] }),
  actor: one(users, {
    fields: [custodyEvents.actorUserId],
    references: [users.id],
  }),
}));

export const verificationTasksRelations = relations(verificationTasks, ({ one }) => ({
  booking: one(bookings, {
    fields: [verificationTasks.bookingId],
    references: [bookings.id],
  }),
  assignee: one(users, {
    fields: [verificationTasks.assigneeUserId],
    references: [users.id],
  }),
}));

export const pickupTasksRelations = relations(pickupTasks, ({ one }) => ({
  booking: one(bookings, {
    fields: [pickupTasks.bookingId],
    references: [bookings.id],
  }),
  assignee: one(users, {
    fields: [pickupTasks.assigneeUserId],
    references: [users.id],
  }),
}));

export const routesRelations = relations(routes, ({ one }) => ({
  driver: one(drivers, { fields: [routes.driverId], references: [drivers.id] }),
  airport: one(airports, {
    fields: [routes.airportCode],
    references: [airports.code],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
}));

export const pricingRulesRelations = relations(pricingRules, () => ({}));
