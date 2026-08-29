export * from "./errors";
export * from "./config";
export * from "./runtime";

export * from "./booking";
export * from "./extraction";
export * from "./slots";
export * from "./pricing";
export * from "./payments";
export * from "./auth";
export * from "./coverage";
export * from "./waitlist";
export * from "./services";
export * from "./notifications";
export * from "./events";

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
  SlotBlock,
  SlotTier,
  StaffMember,
  TaskStatus,
  TicketExtractionStatus,
  TicketUpload,
  User,
  UserRole,
  VerificationTask,
  WaitlistSignupRow,
  WaitlistSource,
} from "@koolee/db";
