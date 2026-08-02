export * from "./errors";
export * from "./config";
export * from "./runtime";

export * from "./booking";
export * from "./flights";
export * from "./slots";
export * from "./pricing";
export * from "./payments";
export * from "./auth";
export * from "./coverage";
export * from "./services";
export * from "./notifications";

/**
 * Row types, re-exported so apps get them without importing @koolee/db —
 * which the app ESLint config forbids, so that all data access goes through a
 * core service.
 */
export type {
  Address,
  Agent,
  Airport,
  AirlineCutoff,
  AirportCode,
  Bag,
  Booking,
  BookingDraft as BookingDraftRow,
  BookingStatus,
  CustodyEvent,
  CutoffScope,
  Driver,
  Payment,
  PaymentStatus,
  PickupTask,
  PricingRule,
  Route,
  RouteStatus,
  Slot,
  SlotTier,
  TaskStatus,
  User,
  UserRole,
  VerificationTask,
} from "@koolee/db";
